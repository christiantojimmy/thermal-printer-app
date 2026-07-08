const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs'); // Modul bawaan untuk validasi file fisik logo
const { SerialPort } = require('serialport'); 
const { Jimp } = require('jimp'); // Destructuring wajib untuk Jimp v1.x ke atas

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

// FUNGSI INOVASI LOGO: Mengonversi gambar PNG menjadi Buffer Grafis RTPrinter
async function generateRTPrinterBuffer(imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error("File logo.png tidak ditemukan!");
  }

  const image = await Jimp.read(imagePath);
  const targetWidth = 240;
  const targetHeight = Math.round((image.height / image.width) * targetWidth);
  
  image.resize({ w: targetWidth, h: targetHeight });
  image.greyscale().contrast(1);

  const width = image.width;
  const height = image.height;
  const widthBytes = Math.ceil(width / 8);
  const pixelData = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < widthBytes; x++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const pixelX = x * 8 + b;
        if (pixelX < width) {
          const pixelColor = image.getPixelColor(pixelX, y);
          const r = (pixelColor >> 24) & 0xFF;
          const g = (pixelColor >> 16) & 0xFF;
          const bColor = (pixelColor >> 8) & 0xFF;
          const a = pixelColor & 0xFF;
          
          const brightness = (r + g + bColor) / 3;
          if (brightness < 128 && a > 50) { 
            byte |= (0x80 >> b); 
          }
        }
      }
      pixelData.push(byte);
    }
  }

  const commandHeader = Buffer.from([
    0x1D, 0x76, 0x30, 0x00, 
    widthBytes & 0xFF, (widthBytes >> 8) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF
  ]);

  const alignCenter = Buffer.from([0x1B, 0x61, 0x01]);
  const alignLeft = Buffer.from([0x1B, 0x61, 0x00]);

  return Buffer.concat([alignCenter, commandHeader, Buffer.from(pixelData), alignLeft]);
}

// Handle Utama Eksekusi Cetak Label Thermal Hibrida
ipcMain.on('print-job', async (event, data) => {
  const device = new SerialPort({
    path: data.targetPort, 
    baudRate: 9600, 
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
      
      try {
        imageBuffer = await generateRTPrinterBuffer(logoPath);
      } catch (imgErr) {
        console.log("Fallback aktif: Gambar dilewati karena " + imgErr.message);
      }

      const maxLineChars = 48;
      const lineSeparator = "-".repeat(maxLineChars) + "\n";

      // --- BUFFER PERINTAH HARDWARE ---
      const startBold = Buffer.from([0x1B, 0x45, 0x01]); 
      const stopBold = Buffer.from([0x1B, 0x45, 0x00]);  
      const cutCommand = Buffer.from([0x1D, 0x56, 0x42, 0x00]); 

      // 1. BAGIAN HEADER (Logo/Nama Toko)
      let headerText = imageBuffer.length === 0 ? "\n" + centerText("MR J - SERVICE FPV") + "\n" + centerText("Cimahi - Bandung") + "\n" : "\n";
      headerText += "\n";
      const headerBuffer = Buffer.from(headerText, 'utf-8');

      // 2. KONTEN PENGIRIM
      const labelPengirimBuffer = Buffer.from("Pengirim\n", 'utf-8');
      let detailPengirimText = lineSeparator + "Jimmy\n" + "08562343025\n\n";
      const detailPengirimBuffer = Buffer.from(detailPengirimText, 'utf-8');

      // --- PROSES STRIP & FORMAT AUTOMATIS NOMOR HP PENERIMA WA DI SINI ---
      const nomorPenerimaBersih = data.telepon;

      // 3. KONTEN PENERIMA (Menggunakan nomor HP yang sudah dibersihkan formatnya)
      const labelPenerimaBuffer = Buffer.from("Penerima\n", 'utf-8');
      let detailPenerimaText = lineSeparator + `${data.nama}\n` + `${nomorPenerimaBersih}\n`;
      const detailPenerimaBuffer = Buffer.from(detailPenerimaText, 'utf-8');

      // 4. BAGIAN ALAMAT (Teks Normal)
      let alamatText = "";
      data.alamatFormatted.forEach(line => {
        alamatText += `${line}\n`;
      });
      alamatText += "\n";
      const alamatBuffer = Buffer.from(alamatText, 'utf-8');

      // 5. BAGIAN LAYANAN KURIR BOX (Bold)
      let kurirText = "";
      data.kurirFormatted.forEach(line => {
        kurirText += centerText(line) + "\n";
      });
      kurirText += "\n"; 
      const kurirBuffer = Buffer.from(kurirText, 'utf-8');

      // --- TRANSMISI BERANTAI REAL-TIME ---
      device.write(imageBuffer, () => {
        device.write(headerBuffer, () => {
          
          // --- PROSES SEGMEN PENGIRIM ---
          device.write(startBold, () => {
            device.write(labelPengirimBuffer, () => { 
              device.write(stopBold, () => {
                device.write(detailPengirimBuffer, () => { 
                  
                  // --- PROSES SEGMEN PENERIMA ---
                  device.write(startBold, () => {
                    device.write(labelPenerimaBuffer, () => { 
                      device.write(stopBold, () => {
                        device.write(detailPenerimaBuffer, () => { 
                          
                          // --- PROSES CETAK ALAMAT NORMAL ---
                          device.write(alamatBuffer, () => {
                            
                            // --- PROSES CETAK KURIR BOX SECARA BOLD ---
                            device.write(startBold, () => { 
                              device.write(kurirBuffer, () => {
                                device.write(stopBold, () => { 
                                  
                                  // --- PROSES AUTO-CUT ---
                                  device.write(cutCommand, () => {
                                    setTimeout(() => {
                                      device.close();
                                      sendReply(true, 'Cetak label premium berhasil!');
                                    }, 800);
                                  });

                                });
                              });
                            }); 

                          });

                        });
                      });
                    });
                  });

                });
              });
            });
          });

        });
      });

    } catch (printError) {
      if (device.isOpen) device.close();
      sendReply(false, `Error rendering hardware: ${printError.message}`);
    }
  });

  device.on('error', (err) => {
    clearTimeout(backupTimeout);
    sendReply(false, `Gagal koneksi (Error Hardware): ${err.message}`);
  });
});