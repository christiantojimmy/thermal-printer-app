const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const escpos = require('escpos');
const { SerialPort } = require('serialport'); 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 620,
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

// Handle Proses Cetak Thermal
ipcMain.on('print-job', (event, data) => {
  const device = new SerialPort({
    path: data.targetPort, 
    baudRate: 9600,
    autoOpen: false 
  });

  const printer = new escpos.Printer(device);
  const logoPath = path.join(__dirname, 'logo.png');
  
  let hasReplied = false;

  const sendReply = (success, message) => {
    if (!hasReplied) {
      hasReplied = true;
      event.reply('print-status', { success, message });
    }
  };

  // Timer darurat jika OS/Windows mengalami blocking thread bluetooth serial yang mati
  const backupTimeout = setTimeout(() => {
    if (!hasReplied) {
      try { device.destroy(); } catch (e) {}
      sendReply(false, `Gagal: Waktu tunggu habis. Port ${data.targetPort} tidak merespons. Pastikan Bluetooth aktif dan Printer menyala!`);
    }
  }, 4500);

  device.open((err) => {
    if (err) {
      clearTimeout(backupTimeout);
      sendReply(false, `Gagal membuka printer: ${err.message}. Periksa kembali nomor port COM di Device Manager.`);
      return;
    }

    clearTimeout(backupTimeout);

    escpos.Image.load(logoPath, (image) => {
      try {
        // 1. CETAK LOGO DI CENTER
        printer.align('ct').image(image, 'd24').text(''); 

        // 2. DATA PENGIRIM
        printer
          .align('lt') 
          .style('B').text('Pengirim')
          .style('NORMAL').text('································')
          .text('Jimmy')
          .text('0856234205')
          .text('');

        // 3. DATA PENERIMA
        printer
          .style('B').text('Penerima')
          .style('NORMAL').text('································')
          .text(data.nama)
          .text(data.telepon);

        // Cetak baris alamat
        data.alamatFormatted.forEach(line => {
          printer.text(line);
        });

        // 4. CETAK LAYANAN KURIR DOUBLE LINE BOX (CENTER)
        printer.text(''); 
        printer.align('ct').style('B');  

        data.kurirFormatted.forEach(line => {
          printer.text(line);
        });

        printer.feed(3).cut();
        
        setTimeout(() => {
          device.close();
          sendReply(true, 'Cetak berhasil!');
        }, 500);

      } catch (printError) {
        if (device.isOpen) device.close();
        sendReply(false, `Error saat mencetak: ${printError.message}`);
      }
    });
  });

  device.on('error', (err) => {
    clearTimeout(backupTimeout);
    sendReply(false, `Gagal koneksi (Error Hardware): ${err.message}`);
  });
});