# yamaha_musiccast_scrobbler

## Info
Last.FM scrobbler for Yamaha MusicCast devices, ie. CRX-N470D

Simple application to discover MusicCast devices in local network, check what is playing and scrobble it
to Last.FM. Before scrobble application tries to lookup song in Last.FM database for validation 
reasons. If it's successful song will be scrobbled.

Support CRX-* (CRX-N470D, etc.) and WX-* (WX-030, etc.) devices and following inputs:

- CD (only when cd-text available)
- Spotify
- Net radio
- Net server (DLNA)

## Install
You must have node.js installed: https://nodejs.org

Please note - application don't work properly under Windows.

Before you start you need Last.Fm api key and secret - get it here: http://www.last.fm/api/account/create
Key and secret must be placed into file ``secret.json``:

````
{
  "key": "aaaaaabccdff7b027e8fca7da4aaaaaa",
  "secret": "bbbbbb8ffab50feaabefd75c5bbbbbb"
}
````

Next step is running ``npm install`` and ``npm start``

If you haven't granted access for application yet you'll be prompted to open URL first.
