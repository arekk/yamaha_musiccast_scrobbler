var ssdp = require('node-ssdp').Client;
var _ = require('lodash');
var http = require('http');
var crypto = require('crypto');
var lastFmApi = require('lastfmapi');
fs = require('fs');

var devices = [];
var current_songs = [];
var last_fm_client;
var last_fm_session;

function initLastFmClient(onSuccess) {
  fs.readFile('./secret.json', 'utf8', function (err, session) {
    if (err) {
      console.log('Config secret.json is missing, please create one');
    } else {
      var secrets = JSON.parse(session);
      last_fm_client = new lastFmApi({'api_key': secrets.key, 'secret': secrets.secret});
      onSuccess();
    }
  });
}

function authenticateLastFmUser(onSuccess) {
  fs.readFile('./session.json', 'utf8', function (err, session) {
    if (err) {
      last_fm_client.auth.getToken(function (err, token) {
        console.log('Go to url: http://www.last.fm/api/auth/?api_key=' + lastFmApiKey + '&token=' + token + ' give application access and then press any key to continue');
        process.stdin.setRawMode();
        process.stdin.resume();
        process.stdin.on('data', function () {
          last_fm_client.auth.getSession(token, function (err, newSession) {
            if (err) {
              console.log(err);
            } else {
              fs.writeFile('./session.json', JSON.stringify(newSession), function () {
                last_fm_session = newSession;
                console.log("Saved session");
                console.log(last_fm_session);
                onSuccess();
              });
            }
          })
        });
      });
    } else {
      last_fm_session = JSON.parse(session);
      console.log("Restored session");
      console.log(last_fm_session);
      onSuccess();
    }
  });
}

function sendScrobble(song) {
  last_fm_client.setSessionCredentials(last_fm_session.name, last_fm_session.key);
  last_fm_client.track.scrobble({
    'artist': _.get(song, 'artist.name'),
    'track': _.get(song, 'name'),
    'timestamp': Math.floor((new Date()).getTime() / 1000)
  }, function (err) {
    var songInfo = [_.get(song, 'artist.name'), _.get(song, 'album.title', ''), _.get(song, 'name')];
    if (err) {
      console.log('Unable to scrobble', songInfo);
    } else {
      console.log('We have just scrobbled a song', songInfo);
    }
  });
}

function getProperSong(input, artist, album, track, onSuccess, onError) {
  if (input == 'net_radio' && track.length > 0) {
    var search = _.map(_.split(track, '-'), function (s) {
      return _.trim(s);
    });
    if (search.length == 3) {
      artist = search[0];
      track = search[2];
    } else if (search.length == 2) {
      artist = search[0];
      track = search[1];
    } else {
      artist = _.head(search);
      track = _.tail(search).join(' - ');
    }
  }
  if (!artist || !track || artist.length == 0 || track.length == 0) {
    onError('Missing artist or title - unable to identify a song');
  } else {
    last_fm_client.track.getInfo({'artist': artist, 'track': track}, function (err, track) {
      if (err) {
        onError(err);
      } else {
        onSuccess(track);
      }
    });
  }
}

function getSong(ip, input, onReady) {
  var path;
  if (_.indexOf(['spotify', 'net_radio', 'server'], input) > -1) {
    path = '/YamahaExtendedControl/v1/netusb/getPlayInfo';
  } else if (input == 'cd') {
    path = '/YamahaExtendedControl/v1/cd/getPlayInfo';
  }
  if (path) {
    http.get({
        host: ip,
        path: path
      }, function (response) {
        var body = '';
        response.on('data', function (d) {
          body += d;
        });
        response.on('end', function () {
          var parsed = JSON.parse(body);
          if (_.get(parsed, 'playback') == 'play') {
            if (input == 'cd') {
              // yeah, cd-text has artist/track in invalid attributes
              var artist = _.trim(_.get(parsed, 'album', '')), album = '', track = _.trim(_.get(parsed, 'artist', ''));
            } else {
              var artist = _.trim(_.get(parsed, 'artist', '')), album = _.trim(_.get(parsed, 'album', '')), track = _.trim(_.get(parsed, 'track', ''));
            }

            var current = _.get(current_songs, ip);
            var md5sum = crypto.createHash('md5').update(artist + album + track).digest('hex');

            if (current == null || current.checksum != md5sum) {
              var funcSongFound = function (song) {
                console.log('Got ', [_.get(song, 'artist.name'), _.get(song, 'album.title', ''), _.get(song, 'name')], ' - waiting 10s before scrobble');
                _.set(current_songs, [ip], {checksum: md5sum, count: 0, scrobbled: false, song: song});
              };
              var funcSongNotFound = function (err) {
                console.log('Not scrobbling:', err);
                _.set(current_songs, [ip], {checksum: md5sum, count: 0, scrobbled: true, song: null});
              };
              getProperSong(input, artist, album, track, funcSongFound, funcSongNotFound);
            }
            if (current != null && current.checksum == md5sum) {
              _.set(current_songs, [ip, 'count'], (current.count + 1));
            }
            if (current != null && current.checksum == md5sum && current.count > 10 && current.scrobbled == false && current.song != null) {
              _.set(current_songs, [ip, 'scrobbled'], true);
              onReady(current.song);
            }
          }
        });
      }
    );
  }
}

function getInput(ip, onPowerOn) {
  http.get({
    host: ip,
    path: '/YamahaExtendedControl/v1/main/getStatus'
  }, function (response) {
    var body = '';
    response.on('data', function (d) {
      body += d;
    });
    response.on('end', function () {
      var parsed = JSON.parse(body);
      if (_.get(parsed, 'power') == 'on') {
        onPowerOn(ip, _.get(parsed, 'input'));
      }
    });
  });
}

function playInfoLoop() {
  _.each(devices, function (ip) {
    getInput(ip, function (ip, input) {
      getSong(ip, input, function (song) {
        sendScrobble(song);
      })
    })
  });
}

function ssdpSearchLoop() {
  var ssdpClient = new ssdp();
  devices = [];
  ssdpClient.on('response', function inResponse(headers, code, rinfo) {
    var model = _.get(headers, 'X-MODELNAME');
    if (model && (model.indexOf('CRX') !== -1 || model.indexOf('WX') !== -1)) {
      devices.push(rinfo['address']);
    }
    console.log('Current devices:');
    console.log(devices);
  });
  ssdpClient.search('urn:schemas-upnp-org:device:MediaRenderer:1');
}

function run() {
  // loop sor SSDP device discovery
  ssdpSearchLoop();
  setInterval(ssdpSearchLoop, 1000 * 60);

  // loop for scrobbler
  initLastFmClient(function () {
    authenticateLastFmUser(function () {
      setInterval(playInfoLoop, 1000);
    })
  });
}

run();
