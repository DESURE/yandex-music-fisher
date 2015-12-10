/* global chrome, storage, ga, downloader */

(()=> {
    'use strict';

    let utils = {};
    window.utils = utils;

    utils.ajax = (url, type, onProgress) => new Promise((resolve, reject) => {
        let xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = type;
        xhr.onload = () => {
            if (xhr.status === 200) {
                if (xhr.response) {
                    resolve(xhr.response);
                } else {
                    reject({
                        message: 'Пустой ответ',
                        details: url
                    });
                }
            } else {
                reject({
                    message: xhr.statusText + ' (' + xhr.status + ')',
                    details: url
                });
            }
        };
        xhr.onerror = () => reject({
            message: 'Ошибка при запросе',
            details: url
        });

        if (onProgress) {
            xhr.onprogress = onProgress;
        }
        xhr.send();
    });

    utils.delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    utils.bytesToStr = bytes => {
        let KiB = 1024;
        let MiB = 1024 * KiB;
        let GiB = 1024 * MiB;
        if (bytes < GiB) {
            return (bytes / MiB).toFixed(2) + ' МиБ';
        } else {
            return (bytes / GiB).toFixed(2) + ' ГиБ';
        }
    };

    utils.addExtraZeros = (val, max) => {
        let valLength = val.toString().length;
        let maxLength = max.toString().length;
        let diff = maxLength - valLength;
        let zeros = '';
        for (let i = 0; i < diff; i++) {
            zeros += '0';
        }
        return zeros + val;
    };

    utils.durationToStr = duration => {
        let seconds = Math.floor(duration / 1000);
        let minutes = Math.floor(seconds / 60);
        seconds -= minutes * 60;
        let hours = Math.floor(minutes / 60);
        minutes -= hours * 60;
        return hours + ':' + utils.addExtraZeros(minutes, 10) + ':' + utils.addExtraZeros(seconds, 10);
    };

    utils.clearPath = (path, isDir) => {
        let unsafeChars = /[\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
        path = path.replace(/^\./, '_'); // первый символ - точка (https://music.yandex.ru/album/2289231/track/20208868)
        path = path.replace(/"/g, "''"); // двойные кавычки в одинарные
        path = path.replace(/\t/g, ' '); // табы в пробелы (https://music.yandex.ru/album/718010/track/6570232)
        path = path.replace(unsafeChars, '');
        path = path.replace(/[\\/:*?<>|~]/g, '_'); // запрещённые символы в винде
        if (isDir) {
            path = path.replace(/(\.| )$/, '_'); // точка или пробел в конце
            // пример папки с точкой в конце https://music.yandex.ru/album/1288439/
            // пример папки с пробелом в конце https://music.yandex.ru/album/62046/
        }
        return path;
    };

    utils.logError = error => {
        console.error(error.message, error.details);
        if (error.message !== 'Пустой ответ' && error.message !== 'Ошибка трека: no-rights') {
            ga('send', 'event', 'error', error.message, error.details);
        }
    };

    utils.parseArtists = (allArtists, separator) => {
        const VA = 'Various Artists'; // пример https://music.yandex.ru/album/718010/track/6570232
        const UA = 'Unknown Artist'; // пример https://music.yandex.ru/album/533785/track/4790215
        let artists = [];
        let composers = [];
        allArtists.forEach(artist => {
            if (artist.composer) { // пример https://music.yandex.ru/album/717747/track/6672611
                composers.push(artist.name);
            } else if (artist.various) {
                artists.push(VA);
            } else {
                artists.push(artist.name);
            }
        });
        return {
            artists: artists.join(separator) || composers.join(separator) || UA,
            composers: composers.join(separator)
        };
    };

    utils.getUrlInfo = url => {
        let info = {};
        let parts = url.replace(/\?.*/, '').split('/');
        //["http:", "", "music.yandex.ru", "users", "furfurmusic", "playlists", "1000"]
        info.isYandexMusic = (
            parts[2] === 'music.yandex.ru' ||
            parts[2] === 'music.yandex.ua' ||
            parts[2] === 'music.yandex.kz' ||
            parts[2] === 'music.yandex.by'
        );
        if (info.isYandexMusic) {
            storage.current.domain = parts[2].split('.')[2];
        } else {
            return info;
        }
        info.isPlaylist = (parts[3] === 'users' && parts[5] === 'playlists' && !!parts[6]);
        info.isTrack = (parts[3] === 'album' && parts[5] === 'track' && !!parts[6]);
        info.isAlbum = (parts[3] === 'album' && !!parts[4]);
        info.isArtist = (parts[3] === 'artist' && !!parts[4]);
        info.isLabel = (parts[3] === 'label' && !!parts[4]);
        if (info.isPlaylist) {
            info.username = parts[4];
            info.playlistId = parts[6];
        } else if (info.isTrack) {
            info.trackId = parts[6];
        } else if (info.isAlbum) {
            info.albumId = parts[4];
        } else if (info.isArtist) {
            info.artistId = parts[4];
        } else if (info.isLabel) {
            info.labelId = parts[4];
        }
        return info;
    };

    utils.updateTabIcon = tab => {
        let re = /^https?:\/\/music\.yandex\.ru.*/i;
        if (!re.test(tab.url)){
            chrome.pageAction.hide(tab.id);
            return;
        }else{
            chrome.pageAction.show(tab.id);
        }

        let page = utils.getUrlInfo(tab.url);
        let iconPath = 'img/black.png';
        if (page.isPlaylist) {
            iconPath = 'img/green.png';
        } else if (page.isTrack) {
            iconPath = 'img/blue.png';
        } else if (page.isAlbum) {
            iconPath = 'img/yellow.png';
        } else if (page.isArtist || page.isLabel) {
            iconPath = 'img/pink.png';
        }
        chrome.pageAction.setIcon({
            tabId: tab.id,
            path: iconPath
        });
    };

    utils.getActiveTab = () => new Promise((resolve, reject) => {
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, tabs => {
            let activeTab = tabs[0];
            if (activeTab) {
                resolve(activeTab);
            } else {
                reject(new Error('No active tab'));
            }
        });
    });

    utils.getDownload = downloadId => new Promise(resolve => {
        chrome.downloads.search({
            id: downloadId
        }, downloads => {
            let download = downloads[0];
            if (!download) {
                return;
            }
            let name = download.byExtensionName;
            if (name && name === chrome.runtime.getManifest().name) {
                resolve(download);
            }
        });
    });

    utils.updateBadge = () => {
        let count = downloader.getDownloadCount();
        let countStr = '';
        if (count) {
            countStr = count.toString();
        }
    };

    utils.checkUpdate = () => new Promise(resolve => {
        let releaseInfoUrl = 'https://api.github.com/repos/egoroof/yandex-music-fisher/releases/latest';
        utils.ajax(releaseInfoUrl, 'json').then(releaseInfo => {
            let latestVersion = releaseInfo.tag_name.replace('v', '').split('.');
            let currentVersion = chrome.runtime.getManifest().version.split('.');

            let isMajorUpdate = (
                latestVersion[0] > currentVersion[0]
            );
            let isMinorUpdate = (
                latestVersion[1] > currentVersion[1] &&
                latestVersion[0] === currentVersion[0]
            );
            let isPatchUpdate = (
                latestVersion[2] > currentVersion[2] &&
                latestVersion[1] === currentVersion[1] &&
                latestVersion[0] === currentVersion[0]
            );

            if (isMajorUpdate || isMinorUpdate || isPatchUpdate) {
                resolve({
                    version: latestVersion.join('.'),
                    distUrl: releaseInfo.assets[0].browser_download_url
                });
            }
        }).catch(utils.logError);
    });

    utils.existDuplicates = iterable => {
        let uniq = new Set(iterable);
        return uniq.size !== iterable.length;
    };

    utils.addId3Tag = (oldArrayBuffer, framesObject) => {
        let uint32ToUint8Array = uint32 => [
            uint32 >>> 24,
            (uint32 >>> 16) & 0xff,
            (uint32 >>> 8) & 0xff,
            uint32 & 0xff
        ];

        let uint28ToUint7Array = uint28 => [
            uint28 >>> 21,
            (uint28 >>> 14) & 0x7f,
            (uint28 >>> 7) & 0x7f,
            uint28 & 0x7f
        ];

        let framesObjectToArray = framesObject => {
            let frames = [];
            let frameIterator = Object.keys(framesObject);
            for (let i = 0; i < frameIterator.length; i++) {
                let frameValue = framesObject[frameIterator[i]];
                if (typeof(frameValue) === 'number') {
                    frames.push({
                        name: frameIterator[i],
                        value: frameValue,
                        size: 10 + frameValue.toString().length + 1 // заголовок + фрейм + кодировка
                    });
                } else if (typeof(frameValue) === 'string') {
                    frames.push({
                        name: frameIterator[i],
                        value: frameValue,
                        size: 10 + (frameValue.length * 2) + 1 + 2 // заголовок + фрейм * 2 байта + кодировка + BOM
                    });
                } else if (frameIterator[i] === 'APIC') {
                    let mimeType = 'image/jpeg';
                    frames.push({
                        name: frameIterator[i],
                        value: frameValue,
                        mimeType: mimeType,
                        size: 10 + 1 + mimeType.length + 1 + 1 + 1 + frameValue.byteLength
                        // заголовок + кодировка + MIME type + 0 + тип картинки + 0 + картинка
                    });
                }
            }
            return frames;
        };

        let offset = 0;
        let padding = 4096;
        let frames = framesObjectToArray(framesObject);
        let totalFrameSize = frames.reduce((totalSize, frame) => totalSize + frame.size, 0);
        let tagSize = totalFrameSize + padding + 10; // 10 на заголовок тега
        let arrayBuffer = new ArrayBuffer(oldArrayBuffer.byteLength + tagSize);
        let bufferWriter = new Uint8Array(arrayBuffer);
        let coder8 = new TextEncoder('utf-8');
        let coder16 = new TextEncoder('utf-16le');

        let writeBytes = [0x49, 0x44, 0x33, 0x03]; // тег (ID3) и версия (3)
        bufferWriter.set(writeBytes, offset);
        offset += writeBytes.length;

        offset++; // ревизия версии
        offset++; // флаги

        writeBytes = uint28ToUint7Array(tagSize); // размер тега
        bufferWriter.set(writeBytes, offset);
        offset += writeBytes.length;

        frames.forEach(frame => {
            writeBytes = coder8.encode(frame.name); // название фрейма
            bufferWriter.set(writeBytes, offset);
            offset += writeBytes.length;

            writeBytes = uint32ToUint8Array(frame.size - 10); // размер фрейма (без заголовка)
            bufferWriter.set(writeBytes, offset);
            offset += writeBytes.length;

            offset += 2; // флаги

            if (typeof(frame.value) === 'number') {
                offset++; // кодировка

                writeBytes = coder8.encode(frame.value); // значение фрейма
                bufferWriter.set(writeBytes, offset);
                offset += writeBytes.length;
            } else if (typeof(frame.value) === 'string') {
                writeBytes = [0x01, 0xff, 0xfe]; // кодировка и BOM
                bufferWriter.set(writeBytes, offset);
                offset += writeBytes.length;

                writeBytes = coder16.encode(frame.value); // значение фрейма
                bufferWriter.set(writeBytes, offset);
                offset += writeBytes.length;
            } else if (frame.name === 'APIC') {
                offset++; // кодировка

                writeBytes = coder8.encode(frame.mimeType); // MIME type
                bufferWriter.set(writeBytes, offset);
                offset += writeBytes.length;

                writeBytes = [0x00, 0x03, 0x00]; // разделитель, тип картинки, разделитель
                bufferWriter.set(writeBytes, offset);
                offset += writeBytes.length;

                bufferWriter.set(new Uint8Array(frame.value), offset); // картинка
                offset += frame.value.byteLength;
            }
        });

        offset += padding; // пустое место для перезаписи фреймов
        bufferWriter.set(new Uint8Array(oldArrayBuffer), offset);
        let blob = new Blob([arrayBuffer], {type: 'audio/mpeg'});
        return window.URL.createObjectURL(blob);
    };

})();
