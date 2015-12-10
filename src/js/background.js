/* global chrome, storage, utils, downloader, ga */

(()=> {
    'use strict';

    let distributionUrl;

    (function (i, s, o, g, r, a, m) {
        i.GoogleAnalyticsObject = r;
        i[r] = i[r] || function () {
                (i[r].q = i[r].q || []).push(arguments);
            };
        i[r].l = 1 * new Date();
        a = s.createElement(o);
        m = s.getElementsByTagName(o)[0];
        a.async = 1;
        a.src = g;
        m.parentNode.insertBefore(a, m);
    })(window, document, 'script', 'https://www.google-analytics.com/analytics.js', 'ga');

    ga('create', 'UA-65530110-1', 'auto');
    ga('set', 'checkProtocolTask', null); // разрешает протокол "chrome-extension"
    ga('set', 'page', '/home');
    ga('send', 'event', 'load', chrome.runtime.getManifest().version);

    window.onerror = (message, file, line, col, error) => {
        let relativePattern = /chrome-extension:\/\/[^\/]+/g;
        let report = chrome.runtime.getManifest().version + ': ' + error.stack.replace(relativePattern, '').replace(/\n/g, '');
        utils.getActiveTab()
            .then(activeTab => ga('send', 'event', 'onerror', report, activeTab.url))
            .catch(() => ga('send', 'event', 'onerror', report));
    };

    utils.updateBadge();

    chrome.runtime.onInstalled.addListener(details => { // установка или обновление расширения
        storage.init();
        let version = chrome.runtime.getManifest().version;
        if (details.reason === 'install') {
            ga('send', 'event', 'install', version);
        } else if (details.reason === 'update' && details.previousVersion !== version) {
            ga('send', 'event', 'update', details.previousVersion + ' > ' + version);
        }
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'loading') { // переход по новому URL
            utils.updateTabIcon(tab);
        }
    });

    chrome.tabs.onActivated.addListener(activeInfo => {
        chrome.tabs.get(activeInfo.tabId, tab => { // переключение вкладки
            if (chrome.runtime.lastError) { // консоль
                return;
            }
            utils.updateTabIcon(tab);
        });
    });

    chrome.downloads.onChanged.addListener(delta => {
        if (!delta.state) {
            return; // состояние не изменилось (начало загрузки)
        }
        utils.getDownload(delta.id).then(download => {
            let entity = downloader.getEntityByBrowserDownloadId(delta.id);
            if (entity) {
                // не попадут: архив с обновлением,
                // трек и обложка при удалённой сущности в процессе сохранения BLOB (теоретически, но маловероятно)
                if (delta.state.current === 'complete') {
                    entity.status = downloader.STATUS.FINISHED;
                    utils.updateBadge();
                } else if (delta.state.current === 'interrupted') {
                    entity.attemptCount++;
                    entity.loadedBytes = 0;
                    if (entity.attemptCount < 3) {
                        utils.delay(10000).then(() => {
                            entity.status = downloader.STATUS.WAITING;
                            downloader.download();
                        });
                    } else {
                        entity.status = downloader.STATUS.INTERRUPTED;
                        let error = {
                            message: download.error,
                            details: ''
                        };
                        if (entity.type === downloader.TYPE.TRACK) {
                            error.details = entity.track.id;
                        } else if (entity.type === downloader.TYPE.COVER) {
                            error.details = entity.url;
                        }
                        utils.logError(error);
                    }
                }
                window.URL.revokeObjectURL(download.url);
            }
            chrome.downloads.setShelfEnabled(true);
            chrome.downloads.erase({
                id: delta.id
            });
            downloader.activeThreadCount--;
            downloader.download();
        });
    });

    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
        if (notificationId !== 'yandex-music-fisher-update') {
            return;
        }
        if (buttonIndex === 0) {
            chrome.downloads.showDefaultFolder();
            chrome.notifications.clear(notificationId);
            chrome.downloads.download({
                url: distributionUrl,
                conflictAction: 'overwrite',
                saveAs: false
            });
        } else if (buttonIndex === 1) {
            chrome.tabs.create({
                url: 'https://github.com/egoroof/yandex-music-fisher/releases'
            });
        }
    });

    storage.load().then(() => {
        if (storage.current.shouldNotifyAboutUpdates) {
            return utils.checkUpdate();
        } else {
            throw new Error('Update notifications are disabled');
        }
    }).then(updateInfo => {
        distributionUrl = updateInfo.distUrl;
        chrome.notifications.create('yandex-music-fisher-update', {
            type: 'basic',
            iconUrl: '/img/icon.png',
            title: 'Yandex Music Fisher',
            message: 'Доступно обновление ' + updateInfo.version,
            contextMessage: 'Обновления устанавливаются вручную!',
            buttons: [{
                title: 'Скачать обновление',
                iconUrl: '/img/download.png'
            }, {
                title: 'Просмотреть изменения'
            }],
            isClickable: false
        });
    }).catch(err => console.info(err));

})();
