const Discord = require("discord.js");
const TenmaGabriel = new Discord.Client();
const fs = require('fs');
const URL = require('url');
const async = require('async');
const request = require('request');
const path = require('path');
const { Client, Util } = require('discord.js');
const { TOKEN, PREFIX, GOOGLE_API_KEY } = require('./config');
const YouTube = require('simple-youtube-api');
const ytdl = require('ytdl-core');

const client = new Client({ disableEveryone: true });

const youtube = new YouTube(GOOGLE_API_KEY);

const queue = new Map();

client.on('warn', console.warn);

client.on('error', console.error);

client.on('ready', () => console.log('Yo this ready!'));

client.on('disconnect', () => console.log('I just disconnected, making sure you know, I will reconnect now...'));

client.on('reconnecting', () => console.log('I am reconnecting now!'));

client.on('message', async msg => { // eslint-disable-line
	if (msg.author.bot) return undefined;
	if (!msg.content.startsWith(PREFIX)) return undefined;

	const args = msg.content.split(' ');
	const searchString = args.slice(1).join(' ');
	const url = args[1] ? args[1].replace(/<(.+)>/g, '$1') : '';
	const serverQueue = queue.get(msg.guild.id);

	let command = msg.content.toLowerCase().split(' ')[0];
	command = command.slice(PREFIX.length)

	if (command === 'play') {
		const voiceChannel = msg.member.voiceChannel;
		if (!voiceChannel) return msg.channel.send('방에들어가');
		const permissions = voiceChannel.permissionsFor(msg.client.user);
		if (!permissions.has('CONNECT')) {
			return msg.channel.send('방에들어갈수가없어');
		}
		if (!permissions.has('SPEAK')) {
			return msg.channel.send('방에서 말을할수가없어');
		}

		if (url.match(/^https?:\/\/(www.youtube.com|youtube.com)\/playlist(.*)$/)) {
			const playlist = await youtube.getPlaylist(url);
			const videos = await playlist.getVideos();
			for (const video of Object.values(videos)) {
				const video2 = await youtube.getVideoByID(video.id); // eslint-disable-line no-await-in-loop
				await handleVideo(video2, msg, voiceChannel, true); // eslint-disable-line no-await-in-loop
			}
			return msg.channel.send(`✅ Playlist: **${playlist.title}** 예약목록에추가!`);
		} else {
			try {
				var video = await youtube.getVideo(url);
			} catch (error) {
				try {
					var videos = await youtube.searchVideos(searchString, 10);
					let index = 0;
					msg.channel.send(`
__**노래선택:**__

${videos.map(video2 => `**${++index} -** ${video2.title}`).join('\n')}

1~10까지 채팅으로 골라줘
					`);
					// eslint-disable-next-line max-depth
					try {
						var response = await msg.channel.awaitMessages(msg2 => msg2.content > 0 && msg2.content < 11, {
							maxMatches: 1,
							time: 10000,
							errors: ['time']
						});
					} catch (err) {
						console.error(err);
						return msg.channel.send('값이 입력되지 않았거나 잘못되어서 비디오 선택을 취소함.');
					}
					const videoIndex = parseInt(response.first().content);
					var video = await youtube.getVideoByID(videos[videoIndex - 1].id);
				} catch (err) {
					console.error(err);
					return msg.channel.send('🆘 검색 결과를 얻을 수 없어.');
				}
			}
			return handleVideo(video, msg, voiceChannel);
		}
	} else if (command === 'skip') {
		if (!msg.member.voiceChannel) return msg.channel.send('넌현재 채널에없어!');
		if (!serverQueue) return msg.channel.send('더이상 스킵할 노래가없어');
		serverQueue.connection.dispatcher.end('Skip command has been used!');
		return undefined;
	} else if (command === 'stop') {
		if (!msg.member.voiceChannel) return msg.channel.send('넌현재 채널에없어!');
		if (!serverQueue) return msg.channel.send('멈출 노래가 없어');
		serverQueue.songs = [];
		serverQueue.connection.dispatcher.end('Stop command has been used!');
		return undefined;
	} else if (command === 'volume') {
		if (!msg.member.voiceChannel) return msg.channel.send('넌 현재채널에없어!');
		if (!serverQueue) return msg.channel.send('재생중인 노래가 없어.');
		if (!args[1]) return msg.channel.send(`볼륨: **${serverQueue.volume}**`);
		serverQueue.volume = args[1];
		serverQueue.connection.dispatcher.setVolumeLogarithmic(args[1] / 5);
		return msg.channel.send(`볼륨설정: **${args[1]}**`);
	} else if (command === 'np') {
		if (!serverQueue) return msg.channel.send('재생중인노래가없어.');
		return msg.channel.send(`🎶 플레이: **${serverQueue.songs[0].title}**`);
	} else if (command === 'queue') {
		if (!serverQueue) return msg.channel.send('재생중인노래가없어.');
		return msg.channel.send(`
__**예약목록:**__

${serverQueue.songs.map(song => `**-** ${song.title}`).join('\n')}

**플레이중:** ${serverQueue.songs[0].title}
		`);
	} else if (command === 'pause') {
		if (serverQueue && serverQueue.playing) {
			serverQueue.playing = false;
			serverQueue.connection.dispatcher.pause();
			return msg.channel.send('⏸ 일시정지!');
		}
		return msg.channel.send('재생중인노래가없어.');
	} else if (command === 'resume') {
		if (serverQueue && !serverQueue.playing) {
			serverQueue.playing = true;
			serverQueue.connection.dispatcher.resume();
			return msg.channel.send('▶ 노래이어서재생!');
		}
		return msg.channel.send('재생중인노래가없어.');
	}

	return undefined;
});

async function handleVideo(video, msg, voiceChannel, playlist = false) {
	const serverQueue = queue.get(msg.guild.id);
	console.log(video);
	const song = {
		id: video.id,
		title: Util.escapeMarkdown(video.title),
		url: `https://www.youtube.com/watch?v=${video.id}`
	};
	if (!serverQueue) {
		const queueConstruct = {
			textChannel: msg.channel,
			voiceChannel: voiceChannel,
			connection: null,
			songs: [],
			volume: 5,
			playing: true
		};
		queue.set(msg.guild.id, queueConstruct);

		queueConstruct.songs.push(song);

		try {
			var connection = await voiceChannel.join();
			queueConstruct.connection = connection;
			play(msg.guild, queueConstruct.songs[0]);
		} catch (error) {
			console.error(`I could not join the voice channel: ${error}`);
			queue.delete(msg.guild.id);
			return msg.channel.send(`I could not join the voice channel: ${error}`);
		}
	} else {
		serverQueue.songs.push(song);
		console.log(serverQueue.songs);
		if (playlist) return undefined;
		else return msg.channel.send(`✅ **${song.title}** 방에들어갈수가없어!`);
	}
	return undefined;
}

function play(guild, song) {
	const serverQueue = queue.get(guild.id);

	if (!song) {
		serverQueue.voiceChannel.leave();
		queue.delete(guild.id);
		return;
	}
	console.log(serverQueue.songs);

	const dispatcher = serverQueue.connection.playStream(ytdl(song.url))
		.on('end', reason => {
			if (reason === 'Stream is not generating quickly enough.') console.log('Song ended.');
			else console.log(reason);
			serverQueue.songs.shift();
			play(guild, serverQueue.songs[0]);
		})
		.on('error', error => console.error(error));
	dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);

	serverQueue.textChannel.send(`🎶 플레이: **${song.title}**`);
}

client.login(TOKEN);



client.on("message", (message)=> {
    if(message.content == "가브릴"){
        message.reply("왜?");
    }
})


client.on('message', message => {
     if(message.content.startsWith('안녕')){
        message.reply("안뇽");
    }
    if(message.content.startsWith('남중홈페이지')){
        message.reply("http://namjung.ms.kr/");
    }
    if(message.content.startsWith('영선중홈페이지')){
        message.reply("http://yeongseon.ms.kr/");
    }
    if(message.content.startsWith('신선중홈페이지')){
        message.reply("http://shinseon.ms.kr/");
    }
    if(message.content.startsWith('해동중홈페이지')){
        message.reply("http://haedong.ms.kr/");
    }
        if(message.content.startsWith('남도여중홈페이지')){
        message.reply("http://namdo.ms.kr/");
        }
         if(message.content.startsWith('네이버')){
        message.reply("http://naver.com");
         }
        if(message.content.startsWith('구글')){
        message.reply("http://google.com");
        }})



    client.on('message', message => {
    if(message.content == 'ggta5계정'){
    message.reply("계정1~4까지 고르시오.(예시:ggta5계정1) // 홈페이지:ggta5홈페이지");
    }
   if(message.content == 'ggta5계정1'){
   message.reply("아이디:40873@naver.com // 비밀번호:Dbdn4087(원래사용하던주인에 의해 비밀번호가 변경되었을 수 있음.)");
}
    if(message.content == 'ggta5계정2'){
   message.reply("아이디:tlswkddl12@gmail.com // 비밀번호:ZXCVASDF1224!(원래사용하던주인에 의해 비밀번호가 변경되었을 수 있음.)");
}
    if(message.content == 'ggta5계정3'){
   message.reply("아이디:janworld@hanmail.net // 비밀번호:Rlatmdgns1(원래사용하던주인에 의해 비밀번호가 변경되었을 수 있음.)");
    }
    if(message.content == 'ggta5계정4'){
   message.reply("아이디:jyr1818@naver.com // 비밀번호:Jyp3304jyp(원래사용하던주인에 의해 비밀번호가 변경되었을 수 있음.)")
    }
    if(message.content == 'ggta5홈페이지'){
   message.reply("https://ko.socialclub.rockstargames.com/")

}})

client.on("ready", async() => {
    console.log('online!');
    client.user.setActivity("'g'로 명령어대기중", {type: "WATCHING"});
});
