const path = require('path');
const fs   = require('fs');

const IMAGES_FILE = path.join(__dirname, '../data/images.json');

function loadImages() {
    try {
        if (fs.existsSync(IMAGES_FILE)) {
            return JSON.parse(fs.readFileSync(IMAGES_FILE, 'utf8'));
        }
    } catch { /* fall through */ }
    return { banner: null, thumbnail: null, footerIcon: null, topBanner: null, bottomBanner: null };
}

function saveImages(data) {
    fs.writeFileSync(IMAGES_FILE, JSON.stringify(data, null, 2));
}

module.exports = { loadImages, saveImages };
