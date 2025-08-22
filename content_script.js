function uint8ArrayToBase64(uint8array) {
    return btoa(String.fromCharCode.apply(null, uint8array));
}

function uint8ArrayToString(uint8array) {
    return String.fromCharCode.apply(null, uint8array);
}

function base64toUint8Array(base64_string) {
    return Uint8Array.from(atob(base64_string), (c) => c.charCodeAt(0));
}

function compareUint8Arrays(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    return Array.from(arr1).every((value, index) => value === arr2[index]);
}

function emitAndWaitForResponse(type, data) {
    return new Promise((resolve) => {
        const requestId = Math.random().toString(16).substring(2, 9);
        const responseHandler = (event) => {
            const { detail } = event;
            if (detail.substring(0, 7) === requestId) {
                document.removeEventListener("responseReceived", responseHandler);
                resolve(detail.substring(7));
            }
        };
        document.addEventListener("responseReceived", responseHandler);
        const requestEvent = new CustomEvent("response", {
            detail: {
                type: type,
                body: data,
                requestId: requestId,
            },
        });
        document.dispatchEvent(requestEvent);
    });
}

const fnproxy = (object, func) => new Proxy(object, { apply: func });
const proxy = (object, key, func) =>
    Object.hasOwnProperty.call(object, key) &&
    Object.defineProperty(object, key, {
        value: fnproxy(object[key], func),
    });

function getEventListeners(type) {
    if (this == null) return [];
    const store = this[Symbol.for(getEventListeners)];
    if (store == null || store[type] == null) return [];
    return store[type];
}

class Evaluator {
    static isDASH(text) {
        return text.includes("<mpd") && text.includes("</mpd>");
    }

    static isHLS(text) {
        return text.includes("#extm3u");
    }

    static isHLSMaster(text) {
        return text.includes("#ext-x-stream-inf");
    }

    static isMSS(text) {
        return text.includes("<smoothstreamingmedia") && text.includes("</smoothstreamingmedia>");
    }

    static getManifestType(text) {
        const lower = text.toLowerCase();
        if (this.isDASH(lower)) {
            return "DASH";
        } else if (this.isHLS(lower)) {
            if (this.isHLSMaster(lower)) {
                return "HLS_MASTER";
            } else {
                return "HLS_PLAYLIST";
            }
        } else if (this.isMSS(lower)) {
            return "MSS";
        }
    }
}

(async () => {
    if (typeof EventTarget !== "undefined") {
        proxy(EventTarget.prototype, "addEventListener", async (_target, _this, _args) => {
            if (_this != null) {
                const [type, listener] = _args;

                const storeKey = Symbol.for(getEventListeners);
                if (!(storeKey in _this)) _this[storeKey] = {};

                const store = _this[storeKey];
                if (!(type in store)) store[type] = [];
                const listeners = store[type];

                let wrappedListener = listener;
                if (
                    type === "message" &&
                    !!listener &&
                    !listener._isWrapped &&
                    typeof MediaKeyMessageEvent !== "undefined"
                ) {
                    wrappedListener = async function (event) {
                        if (event instanceof MediaKeyMessageEvent) {
                            if (event._isCustomEvent) {
                                if (listener.handleEvent) {
                                    listener.handleEvent(event);
                                } else {
                                    listener.call(this, event);
                                }
                                return;
                            }

                            let newBody = new Uint8Array(event.message);
                            if (!compareUint8Arrays(new Uint8Array([0x08, 0x04]), new Uint8Array(event.message))) {
                                // console.log("[WidevineProxy2]", "WIDEVINE_PROXY", "MESSAGE", listener);
                                if (listener.name !== "messageHandler") {
                                    const oldChallenge = uint8ArrayToBase64(new Uint8Array(event.message));
                                    const newChallenge = await emitAndWaitForResponse("REQUEST", oldChallenge);
                                    if (oldChallenge !== newChallenge) {
                                        // Playback will fail if the challenges are the same (aka. the background script
                                        // returned the same challenge because the addon is disabled), but I still
                                        // override the challenge anyway, so check beforehand (in base64 form)
                                        newBody = base64toUint8Array(newChallenge);
                                    }
                                } else {
                                    // trick EME Logger
                                    // better suggestions for avoiding EME Logger interference are welcome
                                    await emitAndWaitForResponse("REQUEST", "");
                                }
                            }

                            const newEvent = new MediaKeyMessageEvent("message", {
                                isTrusted: event.isTrusted,
                                bubbles: event.bubbles,
                                cancelBubble: event.cancelBubble,
                                composed: event.composed,
                                currentTarget: event.currentTarget,
                                defaultPrevented: event.defaultPrevented,
                                eventPhase: event.eventPhase,
                                message: newBody.buffer,
                                messageType: event.messageType,
                                returnValue: event.returnValue,
                                srcElement: event.srcElement,
                                target: event.target,
                                timeStamp: event.timeStamp,
                            });
                            newEvent._isCustomEvent = true;

                            _this.dispatchEvent(newEvent);
                            event.stopImmediatePropagation();
                            return;
                        }

                        if (listener.handleEvent) {
                            listener.handleEvent(event);
                        } else {
                            listener.call(this, event);
                        }
                    };

                    wrappedListener._isWrapped = true;
                    wrappedListener.originalListener = listener;
                }

                const alreadyAdded = listeners.some(
                    (storedListener) => storedListener && storedListener.originalListener === listener
                );

                if (!alreadyAdded) {
                    listeners.push(wrappedListener);
                    _args[1] = wrappedListener;
                }
            }
            return _target.apply(_this, _args);
        });
    }

    if (typeof MediaKeySession !== "undefined") {
        proxy(MediaKeySession.prototype, "update", async (_target, _this, _args) => {
            try {
                const [response] = _args;
                // console.log("[WidevineProxy2]", "WIDEVINE_PROXY", "UPDATE");
                await emitAndWaitForResponse("RESPONSE", uint8ArrayToBase64(new Uint8Array(response)));
                const result = await _target.apply(_this, _args);
                return result;
            } catch (error) {}
        });
    }
})();

let pssh_base64 = "";
let overridePSSH = false;

document.addEventListener("NEED_PSSH", (event) => {
    pssh_base64 = event.detail.pssh_base64;
    overridePSSH = event.detail.overridePSSH;
});

document.addEventListener("UPDATE_PSSH", (event) => {
    if (typeof event.detail === "string" && event.detail.length > 0) {
        pssh_base64 = event.detail.trim();
    }
});

document.addEventListener("OVERRIDE_PSSH", (event) => {
    overridePSSH = event.detail;
});

const origGenerateRequest = MediaKeySession.prototype.generateRequest;
MediaKeySession.prototype.generateRequest = function (initDataType, initData) {
    try {
        // Giải mã initData thành Uint8Array
        if (!overridePSSH || !pssh_base64) return origGenerateRequest.call(this, initDataType, initData);

        const originalData = new Uint8Array(initData);

        console.log("[WidevineProxy2]", "Original initDataType:", initDataType);
        console.log("[WidevineProxy2]", "Original initData (base64):", btoa(String.fromCharCode(...originalData)));

        // 🔹 TODO: parse PSSH nếu cần
        // Ví dụ thay PSSH bằng của bạn
        const newInitData = Uint8Array.from(atob(pssh_base64), (c) => c.charCodeAt(0));

        console.log("[WidevineProxy2]", "Replaced initData (base64):", pssh_base64);

        return origGenerateRequest.call(this, initDataType, newInitData.buffer);
    } catch (err) {
        console.log("[WidevineProxy2]", "EME_HOOK_ERROR", err.message);
        return origGenerateRequest.call(this, initDataType, initData);
    }
};

const originalFetch = window.fetch;
window.fetch = function () {
    return new Promise(async (resolve, reject) => {
        originalFetch
            .apply(this, arguments)
            .then((response) => {
                if (response) {
                    response
                        .clone()
                        .text()
                        .then((text) => {
                            const manifest_type = Evaluator.getManifestType(text);
                            if (manifest_type) {
                                if (arguments.length === 1) {
                                    emitAndWaitForResponse(
                                        "MANIFEST",
                                        JSON.stringify({
                                            url: arguments[0].url,
                                            type: manifest_type,
                                        })
                                    );
                                } else if (arguments.length === 2) {
                                    emitAndWaitForResponse(
                                        "MANIFEST",
                                        JSON.stringify({
                                            url: arguments[0],
                                            type: manifest_type,
                                        })
                                    );
                                }
                            }
                            resolve(response);
                        })
                        .catch(() => {
                            resolve(response);
                        });
                } else {
                    resolve(response);
                }
            })
            .catch(() => {
                resolve();
            });
    });
};

const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
    this._method = method;
    return open.apply(this, arguments);
};

const send = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (postData) {
    this.addEventListener("load", async function () {
        if (this._method === "GET") {
            let body = void 0;
            switch (this.responseType) {
                case "":
                case "text":
                    body = this.responseText ?? this.response;
                    break;
                case "json":
                    // TODO: untested
                    body = JSON.stringify(this.response);
                    break;
                case "arraybuffer":
                    // TODO: untested
                    if (this.response.byteLength) {
                        const response = new Uint8Array(this.response);
                        body = uint8ArrayToString(
                            new Uint8Array([...response.slice(0, 2000), ...response.slice(-2000)])
                        );
                    }
                    break;
                case "document":
                    // todo
                    break;
                case "blob":
                    body = await this.response.text();
                    break;
            }
            if (body) {
                const manifest_type = Evaluator.getManifestType(body);
                if (manifest_type) {
                    emitAndWaitForResponse(
                        "MANIFEST",
                        JSON.stringify({
                            url: this.responseURL,
                            type: manifest_type,
                        })
                    );
                }
            }
        }
    });
    return send.apply(this, arguments);
};
