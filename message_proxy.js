(async () => {
    const response = await chrome.runtime.sendMessage({ type: "NEED_PSSH" });
    if (response) {
        const { pssh_base64, overridePSSH, type } = response;
        document.dispatchEvent(new CustomEvent(type, { detail: { pssh_base64, overridePSSH } }));
    }
})();

async function processMessage(detail) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                type: detail.type,
                body: detail.body,
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve(response);
            }
        );
    });
}

document.addEventListener("response", async (event) => {
    const { detail } = event;
    const responseData = await processMessage(detail);
    const responseEvent = new CustomEvent("responseReceived", { detail: detail.requestId.concat(responseData) });
    document.dispatchEvent(responseEvent);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, value } = message;
    document.dispatchEvent(new CustomEvent(type, { detail: value }));
});
