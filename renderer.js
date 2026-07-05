const { ipcRenderer } = require('electron');

const selectComPort = document.getElementById('comPort');
const btnRefreshPort = document.getElementById('btnRefreshPort');
const inputKurir = document.getElementById('kurir');
const inputNama = document.getElementById('nama');
const inputTelepon = document.getElementById('telepon');
const inputAlamat = document.getElementById('alamat');
const btnPrint = document.getElementById('btnPrint');
const statusText = document.getElementById('status');

// --- PENGATURAN PEMINDAIAN PORT COM ---
// Minta daftar COM Port aktif saat aplikasi pertama kali dibuka
ipcRenderer.send('get-com-ports');

// Handler Tombol Refresh Port manual
btnRefreshPort.addEventListener('click', () => {
  selectComPort.innerHTML = '<option value="">Memindai port...</option>';
  ipcRenderer.send('get-com-ports');
});

// Tangkap hasil list COM Port dari Main Process dan masukkan ke Dropdown Select
ipcRenderer.on('com-ports-list', (event, ports) => {
  selectComPort.innerHTML = ''; 
  
  if (ports.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.innerText = 'Tidak ada COM Port terdeteksi';
    selectComPort.appendChild(opt);
    return;
  }

  ports.forEach(port => {
    const opt = document.createElement('option');
    opt.value = port.path;
    opt.innerText = port.friendlyName || port.path; 
    selectComPort.appendChild(opt);
  });
});
// --------------------------------------

// Fungsi Word Wrap teks alamat (Max 32 Karakter per baris) agar tidak terpotong kertas struk
function wrapText(text, maxChars = 32) {
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  words.forEach(word => {
    if (word.includes('\n')) {
      const parts = word.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) {
          lines.push(currentLine.trim());
          currentLine = '';
        }
        currentLine += part + ' ';
      });
    } else if ((currentLine + word).length > maxChars) {
      lines.push(currentLine.trim());
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
  });
  
  if (currentLine.trim() !== '') {
    lines.push(currentLine.trim());
  }
  return lines;
}

// Fungsi membuat format box border kurir menggunakan Double Line Box-Drawing (Usulan 1)
function formatKurirBorder(kurirText) {
  const isiTeks = `  ${kurirText}  `; // Memberi spasi ganda agar terlihat seimbang di dalam box
  const panjangGaris = isiTeks.length;
  
  const atas = "╔" + "═".repeat(panjangGaris) + "╗";
  const tengah = "║" + isiTeks + "║";
  const bawah = "╚" + "═".repeat(panjangGaris) + "╝";

  return [atas, tengah, bawah];
}

// Fungsi Update Tampilan Live Preview secara Real-time
function updatePreview() {
  document.getElementById('p-nama').innerText = inputNama.value || '[Nama Penerima]';
  document.getElementById('p-telepon').innerText = inputTelepon.value || '[No. Telepon Penerima]';
  
  // Format Alamat
  const alamatRaw = inputAlamat.value;
  if (alamatRaw) {
    const alamatLines = wrapText(alamatRaw, 32); 
    document.getElementById('p-alamat').innerHTML = alamatLines.join('<br>');
  } else {
    document.getElementById('p-alamat').innerText = '[Alamat Penerima]';
  }

  // Update Teks Box Border Kurir di bagian bawah preview
  const kurirLines = formatKurirBorder(inputKurir.value);
  document.getElementById('p-kurir').innerText = kurirLines.join('\n');
}

// Pasang listeners untuk mendeteksi perubahan form input
inputKurir.addEventListener('change', updatePreview);
inputNama.addEventListener('input', updatePreview);
inputTelepon.addEventListener('input', updatePreview);
inputAlamat.addEventListener('input', updatePreview);

// Eksekusi Tombol Cetak Label Thermal
btnPrint.addEventListener('click', () => {
  // Validasi jika user belum/tidak memilih COM Port aktif
  if (!selectComPort.value) {
    statusText.innerText = "Gagal: Silakan pilih COM Port Printer terlebih dahulu!";
    statusText.style.color = "red";
    return;
  }

  // Nonaktifkan tombol (disabled) & ubah status untuk mencegah double-klik / spam data
  statusText.innerText = "Mengirim data ke printer... Mohon tunggu...";
  statusText.style.color = "orange";
  btnPrint.disabled = true;
  btnPrint.style.backgroundColor = "#ccc";
  btnPrint.style.cursor = "not-allowed";
  
  const payload = {
    targetPort: selectComPort.value,
    nama: inputNama.value || '-',
    telepon: inputTelepon.value || '-',
    alamatFormatted: wrapText(inputAlamat.value, 32),
    kurirFormatted: formatKurirBorder(inputKurir.value)
  };

  ipcRenderer.send('print-job', payload);
});

// Terima balikan respon status cetak dari Main Process untuk mengaktifkan kembali tombol
ipcRenderer.on('print-status', (event, res) => {
  statusText.innerText = res.message;
  
  if (res.success) {
    statusText.style.color = "green";
  } else {
    statusText.style.color = "red";
  }
  
  // Kembalikan tombol ke kondisi aktif semula
  btnPrint.disabled = false;
  btnPrint.style.backgroundColor = "#007bff";
  btnPrint.style.cursor = "pointer";
});

// Jalankan preview sekali di awal load agar kotak default JNE - REG langsung terbentuk pas
updatePreview();