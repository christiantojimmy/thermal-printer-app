const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport'); 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Handle Request List COM Port dari Renderer
ipcMain.on('get-com-ports', async (event) => {
  try {
    const ports = await SerialPort.list();
    event.reply('com-ports-list', ports);
  } catch (err) {
    event.reply('com-ports-list', []);
  }
});

// Fungsi pembantu untuk membuat teks rata tengah secara manual (Max 48 karakter untuk kertas 80mm)
function centerText(text, maxChars = 48) {
  if (text.length >= maxChars) return text;
  const totalSpasi = maxChars - text.length;
  const spasiKiri = Math.floor(totalSpasi / 2);
  return " ".repeat(spasiKiri) + text;
}

// Handle Proses Cetak Murni Menggunakan Raw Teks (100% Bebas Crash)
ipcMain.on('print-job', (event, data) => {
  // Gunakan baudRate yang sudah sukses dites sebelumnya (9600 atau 115200)
  const device = new SerialPort({
    path: data.targetPort, 
    baudRate: 9600, // <--- Ganti ke 115200 jika printer Anda menggunakan kecepatan tinggi
    autoOpen: false 
  });

  let hasReplied = false;

  const sendReply = (success, message) => {
    if (!hasReplied) {
      hasReplied = true;
      event.reply('print-status', { success, message });
    }
  };

  // Timer darurat anti-freeze (4.5 detik cukup karena teks sangat ringan)
  const backupTimeout = setTimeout(() => {
    if (!hasReplied) {
      try { device.destroy(); } catch (e) {}
      sendReply(false, `Waktu tunggu habis pada Port ${data.targetPort}. Periksa kembali printer Anda.`);
    }
  }, 4500);

  device.open((err) => {
    if (err) {
      clearTimeout(backupTimeout);
      sendReply(false, `Gagal membuka printer: ${err.message}`);
      return;
    }

    clearTimeout(backupTimeout);

    try {
      let rawText = "";
      const maxLineChars = 48; // Batas baku printer 80mm Anda
      const lineSeparator = "-".repeat(maxLineChars) + "\n";

      // 1. INJEKSI ASCII ART LOGO MR J (Pas di tengah-tengah rentang 48 karakter)
      rawText += "          ###   ###  ######       ###\n";
      rawText += "          #### ####  ##   ##      ###\n";
      rawText += "          ## ### ##  ######       ###\n";
      rawText += "          ##  #  ##  ##   ## ##   ###\n";
      rawText += "          ##     ##  ##   ##  ##### \n";
      rawText += "          --     --  --   --  ----- \n";
      rawText += centerText("== SERVICE FPV ==") + "\n\n";
      
      // 2. DATA PENGIRIM (Rata Kiri)
      rawText += "Pengirim:\n";
      rawText += lineSeparator;
      rawText += "Jimmy\n";
      rawText += "08562343025\n\n";
      
      // 3. DATA PENERIMA (Rata Kiri)
      rawText += "Penerima:\n";
      rawText += lineSeparator;
      rawText += `${data.nama}\n`;
      rawText += `${data.telepon}\n`;
      
      // Cetak alamat baris demi baris hasil pembungkusan teks (Word Wrap)
      data.alamatFormatted.forEach(line => {
        rawText += `${line}\n`;
      });
      
      rawText += "\n";

      // 4. LAYANAN KURIR BOX (Rata Tengah Manual)
      data.kurirFormatted.forEach(line => {
        rawText += centerText(line) + "\n";
      });
      
      rawText += "\n"; // Dorong kertas ke depan agar melewati pisau potong

      const textBuffer = Buffer.from(rawText, 'utf-8');
      const cutCommand = Buffer.from([0x1d, 0x56, 0x42, 0x00]); // Command standar auto-cut hardware

      // Kirim data teks langsung, disusul command potong kertas
      device.write(textBuffer, () => {
        device.write(cutCommand, () => {
          setTimeout(() => {
            device.close();
            sendReply(true, 'Cetak berhasil!');
          }, 600);
        });
      });

    } catch (printError) {
      if (device.isOpen) device.close();
      sendReply(false, `Error saat menulis data: ${printError.message}`);
    }
  });

  // Listener proteksi port serial
  device.on('error', (err) => {
    clearTimeout(backupTimeout);
    sendReply(false, `Gagal koneksi (Error Hardware): ${err.message}`);
  });
});