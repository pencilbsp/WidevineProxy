import "../protobuf.min.js";
import "../license_protocol.js";
import { DeviceManager, SettingsManager } from "../util.js";

const key_container = document.getElementById("key-container");

// ================ Main ================
const enabled = document.getElementById("enabled");
enabled.addEventListener("change", async function () {
    await SettingsManager.setEnabled(enabled.checked);
});

// ================ Widevine Device ================
document.getElementById("fileInput").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_PICKER_WVD" });
    window.close();
});

const wvd_combobox = document.getElementById("wvd-combobox");
wvd_combobox.addEventListener("change", async function () {
    await DeviceManager.saveSelectedWidevineDevice(wvd_combobox.options[wvd_combobox.selectedIndex].text);
});

// ============================================

// ================ Custom PSSH ================
const custom_pssh = document.getElementById("custom-pssh");
const pssh_base64 = document.getElementById("pssh-base64");
custom_pssh.addEventListener("change", async function () {
    const overridePSSH = custom_pssh.checked;
    console.log({ overridePSSH });
    chrome.runtime.sendMessage({ type: "OVERRIDE_PSSH", value: overridePSSH });
    await SettingsManager.saveUseCustomPSSH(overridePSSH);
});

pssh_base64.addEventListener("input", async function () {
    const base64_pssh = pssh_base64.value;
    chrome.runtime.sendMessage({ type: "UPDATE_PSSH", value: base64_pssh });
    await SettingsManager.savePSSHBase64(base64_pssh);
});
// =================================================

// ================ Keys ================
const clear = document.getElementById("clear");
clear.addEventListener("click", async function () {
    chrome.runtime.sendMessage({ type: "CLEAR" });
    key_container.innerHTML = "";
});

async function appendLog(result) {
    const key_string = result.keys.map((key) => `${key.kid}:${key.k}`).join(" ");

    const logContainer = document.createElement("div");
    logContainer.classList.add("log-container");
    logContainer.innerHTML = `
        <div class="expandable collapsed">
            <label class="always-visible right-bound">
                <a href="#" class="toggle-button">🔑</a><input type="text" class="text-box" value="${key_string}">
            </label>
            <label class="expanded-only right-bound">
                URL: <input type="text" class="text-box" value="${result.url}">
            </label>
            <label class="expanded-only right-bound">
                PSSH: <input type="text" class="text-box" value="${result.pssh_data}">
            </label>
            ${
                result.manifests.length > 0
                    ? `<label class="expanded-only right-bound manifest-copy">
                <div>Manifest:</div><select id="manifest" class="text-box"></select>
            </label>`
                    : ""
            }
        </div>`;

    if (result.manifests.length > 0) {
        const select = logContainer.querySelector("#manifest");

        result.manifests.forEach((manifest) => {
            const option = new Option(`[${manifest.type}] ${manifest.url}`, JSON.stringify(manifest));
            select.add(option);
        });

        const manifest_copy = logContainer.querySelector(".manifest-copy");
        manifest_copy.addEventListener("click", () => {
            navigator.clipboard.writeText(JSON.parse(select.value).url);
        });
    }

    const expandableDiv = logContainer.querySelector(".expandable");
    expandableDiv.querySelector("a.toggle-button").addEventListener("click", function () {
        if (expandableDiv.classList.contains("collapsed")) {
            expandableDiv.classList.remove("collapsed");
            expandableDiv.classList.add("expanded");
        } else {
            expandableDiv.classList.remove("expanded");
            expandableDiv.classList.add("collapsed");
        }
    });

    key_container.appendChild(logContainer);
}

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === "local") {
        for (const [key, values] of Object.entries(changes)) {
            await appendLog(values.newValue);
        }
    }
});

function checkLogs() {
    chrome.runtime.sendMessage({ type: "GET_LOGS" }, (response) => {
        if (response) {
            response.forEach(async (result) => {
                await appendLog(result);
            });
        }
    });
}

document.addEventListener("DOMContentLoaded", async function () {
    enabled.checked = await SettingsManager.getEnabled();

    custom_pssh.checked = await SettingsManager.getUseCustomPSSH();

    pssh_base64.value = await SettingsManager.getPSSHBase64();

    await DeviceManager.loadSetAllWidevineDevices();
    await DeviceManager.selectWidevineDevice(await DeviceManager.getSelectedWidevineDevice());
    checkLogs();
});
// ======================================
