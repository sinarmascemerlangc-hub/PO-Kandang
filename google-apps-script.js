// ============================================
// GOOGLE APPS SCRIPT - Upload Bukti Surat Jalan
// ============================================
// Cara pakai:
// 1. Buka script.google.com → New Project
// 2. Paste kode ini
// 3. Ganti FOLDER_ID dengan ID folder Google Drive Anda
// 4. Deploy → New Deployment → Web App
// 5. Execute as: Me, Who has access: Anyone
// 6. Copy URL deployment → paste ke .env GOOGLE_SCRIPT_URL
// ============================================

// GANTI INI dengan folder ID dari Google Drive
const FOLDER_ID = 'FOLDER_ID_DISINI';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const folder = DriveApp.getFolderById(FOLDER_ID);

    // Decode base64 image
    const imageData = data.image.replace(/^data:image\/\w+;base64,/, '');
    const blob = Utilities.newBlob(
      Utilities.base64Decode(imageData),
      data.mimeType || 'image/jpeg',
      `surat-jalan-${data.deliveryId}-${Date.now()}.jpg`
    );

    // Upload ke Google Drive
    const file = folder.createFile(blob);

    // Set sharing agar bisa diakses publik
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Return URL file
    const url = file.getUrl().replace('/edit', '/preview');

    return ContentService.createTextOutput(JSON.stringify({
      url: url,
      fileId: file.getId(),
      fileName: file.getName(),
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Health check
function doGet(e) {
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}
