const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs'); // Modul bawaan untuk validasi file fisik logo
const { SerialPort } = require('serialport'); 
const { Jimp } = require('jimp'); // Destructuring untuk Jimp v1.x ke atas

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

// Handle Request List COM Port dari Renderer UI
ipcMain.on('get-com-ports', async (event) => {
  try {
    const ports = await SerialPort.list();
    event.reply('com-ports-list', ports);
  } catch (err) {
    event.reply('com-ports-list', []);
  }
});

// Fungsi pembantu untuk membuat teks rata tengah secara manual (Basis Kertas 80mm = 48 karakter)
function centerText(text, maxChars = 48) {
  if (text.length >= maxChars) return text;
  const totalSpasi = maxChars - text.length;
  const spasiKiri = Math.floor(totalSpasi / 2);
  return " ".repeat(spasiKiri) + text;
}

// FUNGSI INOVASI: Kebal dari update Jimp karena menggunakan ekstraksi warna manual (Bitwise Shift)
async function generateRTPrinterBuffer(imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error("File logo.png tidak ditemukan!");
  }

  // 1. Ambil data gambar menggunakan Jimp v1.x
  const image = await Jimp.read(imagePath);
  
  // 2. Hitung dimensi proporsional agar tidak gepeng
  const targetWidth = 240;
  const targetHeight = Math.round((image.height / image.width) * targetWidth);
  
  // Sesuai skema Zod Jimp v1.x: { w, h }
  image.resize({ w: targetWidth, h: targetHeight });
  image.greyscale().contrast(1);

  const width = image.width;
  const height = image.height;
  const widthBytes = Math.ceil(width / 8);
  const pixelData = [];

  // 3. Looping data pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < widthBytes; x++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const pixelX = x * 8 + b;
        if (pixelX < width) {
          // Ambil nilai warna integer 32-bit (Format internal Jimp: RGBA)
          const pixelColor = image.getPixelColor(pixelX, y);
          
          // SOLUSI TOTAL: Ekstraksi nilai R, G, B, dan A secara manual tanpa Jimp.intToRGBA!
          const r = (pixelColor >> 24) & 0xFF;
          const g = (pixelColor >> 16) & 0xFF;
          const bColor = (pixelColor >> 8) & 0xFF;
          const a = pixelColor & 0xFF;
          
          // Hitung rata-rata kecerahan (brightness)
          const brightness = (r + g + bColor) / 3;
          
          // Jika warna pixel dominan gelap dan tidak transparan (Alpha > 50)
          if (brightness < 128 && a > 50) { 
            byte |= (0x80 >> b); // Set bit cetak hitam
          }
        }
      }
      pixelData.push(byte);
    }
  }

  // Header Protokol Gambar RTPrinter / ESC-POS Standar (GS v 0 m xL xH yL yH)
  const commandHeader = Buffer.from([
    0x1D, 0x76, 0x30, 0x00, 
    widthBytes & 0xFF, (widthBytes >> 8) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF
  ]);

  const alignCenter = Buffer.from([0x1B, 0x61, 0x01]);
  const alignLeft = Buffer.from([0x1B, 0x61, 0x00]);

  return Buffer.concat([alignCenter, commandHeader, Buffer.from(pixelData), alignLeft]);
}

// Handle Utama Eksekusi Cetak Label Thermal Hibrida (Gambar + Teks Raw)
ipcMain.on('print-job', async (event, data) => {
  const device = new SerialPort({
    path: data.targetPort, 
    baudRate: 9600, // <--- Ganti ke 115200 jika printer Anda disetel berkecepatan tinggi
    autoOpen: false 
  });

  const logoPath = path.join(__dirname, 'logo.png');
  let hasReplied = false;

  const sendReply = (success, message) => {
    if (!hasReplied) {
      hasReplied = true;
      event.reply('print-status', { success, message });
    }
  };

  // Proteksi keamanan: Batas toleransi waktu transmisi Bluetooth Windows (7 Detik)
  const backupTimeout = setTimeout(() => {
    if (!hasReplied) {
      try { device.destroy(); } catch (e) {}
      sendReply(false, `Waktu tunggu habis pada Port ${data.targetPort}. Periksa koneksi Bluetooth.`);
    }
  }, 7000);

  device.open(async (err) => {
    if (err) {
      clearTimeout(backupTimeout);
      sendReply(false, `Gagal membuka printer: ${err.message}`);
      return;
    }

    clearTimeout(backupTimeout);

    try {
      let imageBuffer = Buffer.from([]);
      
      // Jalankan fungsi pengolahan gambar asinkronus Jimp v1.x
      try {
        imageBuffer = await generateRTPrinterBuffer(logoPath);
      } catch (imgErr) {
        console.log("Fallback aktif: Gambar dilewati karena " + imgErr.message);
      }

      // STRUKTUR DATA UTAMA TEKS LABEL (Batas Baku Pas 48 Karakter)
      let rawText = "";
      const maxLineChars = 48;
      const lineSeparator = "-".repeat(maxLineChars) + "\n";

      // Jika logo grafis gagal dimuat atau dilewati, pasang header teks otomatis sebagai cadangan
      if (imageBuffer.length === 0) {
        rawText += "\n";
        rawText += centerText("MR J - SERVICE FPV") + "\n";
      } else {
        rawText += "\n"; // Jarak baris tipis penutup logo gambar agar tidak mepet teks bawah
      }

      rawText += "\n";
            
      // Bagian Konten Struk Pengiriman (Rata Kiri)
      rawText += "Pengirim\n";
      rawText += lineSeparator;
      rawText += "Jimmy\n";
      rawText += "0856234205\n\n";
      
      rawText += "Penerima\n";
      rawText += lineSeparator;
      rawText += `${data.nama}\n`;
      rawText += `${data.telepon}\n`;
      
      // Ambil text array alamat hasil olahan fungsi wrapText dari renderer.js
      data.alamatFormatted.forEach(line => {
        rawText += `${line}\n`;
      });
      
      rawText += "\n";

      // Susun kotak kurir ekspedisi di posisi tengah lembaran
      data.kurirFormatted.forEach(line => {
        rawText += centerText(line) + "\n";
      });
      
      // rawText += "\n\n\n\n"; // Gulung kertas panjang ke depan agar aman disobek manual

      const textBuffer = Buffer.from(rawText, 'utf-8');
      const cutCommand = Buffer.from([0x1D, 0x56, 0x42, 0x00]); // Perintah auto-cut hardware standar

      // TRANSMISI JALUR BERANTAI AMAN: Kirim Data Grafis Logo -> Kirim Teks Alamat -> Eksekusi Potong Kertas
      device.write(imageBuffer, () => {
        device.write(textBuffer, () => {
          device.write(cutCommand, () => {
            setTimeout(() => {
              device.close();
              sendReply(true, 'Cetak berhasil!');
            }, 800);
          });
        });
      });

    } catch (printError) {
      if (device.isOpen) device.close();
      sendReply(false, `Error rendering hardware: ${printError.message}`);
    }
  });

  // Listener proteksi port serial hardware tingkat OS
  device.on('error', (err) => {
    clearTimeout(backupTimeout);
    sendReply(false, `Gagal koneksi (Error Hardware): ${err.message}`);
  });
});