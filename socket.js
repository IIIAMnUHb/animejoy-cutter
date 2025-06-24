const WebSocket = require('ws');
const { HTMLToJSON } = require('html-to-json-parser');
const ffmpeg = require('fluent-ffmpeg')
const path = require('path')
const express = require('express');
const request = require('request');
const https = require('https');
const fs = require('fs');
const app = express();

if(!fs.existsSync('./ready')) fs.mkdirSync('ready');
if(!fs.existsSync('./temp')) fs.mkdirSync('temp');

const ffmpegPath = path.join(__dirname, '..\\ffmpeg', 'ffmpeg.exe');
console.log('FFMPEG FOUND:',ffmpegPath)
ffmpeg.setFfmpegPath(ffmpegPath);

const PORT = 45829;
const server = new WebSocket.Server({ port: 32852 });

server.on('connection', (socket) => {
    socket.on('message', async (data) => {
        const json = JSON.parse(data);
        if (json.a == 'getEpisodes') {
            const url = json.url;
            socket.send(JSON.stringify({
                a: 'getEpisodes',
                d: await getPlayersByLink(url)
            }))
        }
        if (json.a == 'getEpisodeData') {
            const url = json.url;
            const data = await fetch(url);
            const text = await data.text();
            const href = text.split('});player.src([{src: "')[1].split('", type: "')[0];
            socket.send(JSON.stringify({
                a: 'getEpisodeData',
                d: {
                    url: 'https://video.sibnet.ru'+href,
                    referer: url,
                    name: json.name
                }
            }))
        }
        if (json.a == 'cutVideo') {
            socket.send(JSON.stringify({ a: 'log', d: 'Получаем название аниме...' }));

            const pageData = await fetch(json.d.mainUrl);
            const pageText = await pageData.text();
            const title = pageText.split('<title>')[1].split('субтитры смотреть аниме онлайн')[0];

            socket.send(JSON.stringify({ a: 'log', d: 'Название получено: '+title }));
            socket.send(JSON.stringify({ a: 'log', d: 'Начинаем подготовку к скачиванию файла' }));

            const fileId = Date.now().toString();
            const writeStream = fs.createWriteStream('temp/'+fileId+'.mp4');

            await new Promise(r => {
                https.get({
                    hostname: 'video.sibnet.ru',
                    path: json.d.url.split('video.sibnet.ru')[1],
                    headers: {
                        'referer': json.d.referer
                    }
                }, async (res) => {
                    responser(res);
                });
                function responser(res) {
                    socket.send(JSON.stringify({ a: 'log', d: 'Получили частичный файл (СТАТУС: '+res.statusCode+' '+res.statusMessage+')' }));
                    if (res.statusCode == 302) {
                        https.get((res.headers.location.startsWith('//')?'https:':'')+res.headers.location, (res) => responser(res));
                        return;
                    }
                    const totalSize = parseInt(res.headers['content-length'], 10);
                    let downloaded = 0;
                    let counter = 0;

                    res.on('data', (chunk) => {
                        downloaded += chunk.length;
                        const precent = ((downloaded / totalSize) * 100).toFixed(2);
                        if (counter >= 100) {
                            socket.send(JSON.stringify({ a: 'log', d: `Скачивание: ${precent}%` }));
                            counter = 0;
                        } else { counter++; }
                    });
                    res.pipe(writeStream);
                    writeStream.on('finish', ()=>{
                        r();
                        writeStream.close();
                    })
                }
            })
            socket.send(JSON.stringify({ a: 'log', d: `Скачано.` }));
            socket.send(JSON.stringify({ a: 'log', d: `Начинаем обрезание...` }));
            
            const time = new Date((-1000*60*60*3)+Math.floor(0+json.d.startTime*1000));
            const string = time.toTimeString();
            const name = title.replace(')','')+(title.includes('(')?`${json.d.name})`:`(${json.d.name})`)+` [${secondsToMinutes(Math.floor(json.d.startTime))} - ${secondsToMinutes(Math.floor(json.d.endTime))}]`;
            
            ffmpeg('temp/'+fileId+'.mp4')
                .setStartTime(`${string.split('').slice(0, 8).join('')}`)
                .setDuration(`${(json.d.endTime-json.d.startTime)}`)
                .output('./ready/'+ fileId + '.mp4')
                .on('end', function(err) {
                    if (err) { throw new Error(err) };
                    fs.unlinkSync('temp/'+fileId+'.mp4');
                    fs.renameSync('ready/'+fileId+'.mp4', 'ready/'+name+'.mp4')
                    socket.send(JSON.stringify({ a: 'log', d: 'Файл обрезан (ready/'+name+'.mp4)' }));
                })
                .on('error', err => { throw new Error(err) })
                .run()
        }
    })
})

function secondsToMinutes(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
        return `${h} ${m.toString().padStart(2, '0')} ${s.toString().padStart(2, '0')}`;
    } else {
        return `${m} ${s.toString().padStart(2, '0')}`;
    }
}
app.get('/stream', (req, res) => {
    const videoUrl = req.query.url;
    const referer = req.query.referer || 'https://example.com';
    const range = req.headers.range;
  
    if (!videoUrl) {
      return res.status(400).send('Missing url parameter');
    }
  
    const headers = {
      'Referer': referer,
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
    };
  
    if (range) {
      headers['Range'] = range; // добавим Range для запроса
    }
  
    const options = {
      url: videoUrl,
      headers,
    };
  
    const proxy = request.get(options);
  
    proxy.on('response', (videoRes) => {
      // Пробросим заголовки, в том числе для корректной поддержки видео
      res.status(videoRes.statusCode);
  
      // Важно: пробрасываем ключевые заголовки, особенно Range-related
      const headersToCopy = [
        'content-range',
        'accept-ranges',
        'content-length',
        'content-type',
      ];
      headersToCopy.forEach((header) => {
        if (videoRes.headers[header]) {
          res.setHeader(header, videoRes.headers[header]);
        }
      });
    });
  
    proxy.on('error', (err) => {
      console.error(err);
      res.sendStatus(500);
    });
  
    proxy.pipe(res);
  });
  
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});


async function getPlayers(html) {
    const e = await HTMLToJSON(html, true)
    const json = JSON.parse(e);
    const content = json.content;
    const playList = content.find(e => e.attributes && e.attributes.class == 'playlists-lists');
    const listOfPlayers = playList.content[1]?.content[0].content || playList.content[0].content[0].content;
    const sibnetId = listOfPlayers.find(e => e.content.includes('Sibnet')).attributes['data-id'];
    console.log("SIBNET PLAYERID:", sibnetId);
    const playListVideos = content.find(e => e.attributes && e.attributes.class == 'playlists-videos');
    const sibnetVideos = playListVideos.content[1].content[1].content.filter(e => e.attributes && e.attributes['data-id'] == sibnetId);
    const mappedSibnetVideos = sibnetVideos.map(x => ({
        name: x.content[0],
        url: x.attributes['data-file']
    }));
    return mappedSibnetVideos;
};
async function getPlayersByLink(link) {
    const id = link.split('/tv-serialy/')[1].split('-')[0]; 
    const animejoy = await fetch('https://anime-joy.ru/engine/ajax/playlists.php?news_id='+id+'&xfield=playlist');
    const json = await animejoy.json();
    const players = await getPlayers(json.response);
    return players;
}