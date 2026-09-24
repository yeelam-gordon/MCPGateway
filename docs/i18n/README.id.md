# Mulai cepat Shared MCP Gateway

[English](../../README.md)

> Ini adalah panduan mulai cepat yang dilokalkan. [README](../../README.md) berbahasa Inggris merupakan sumber utama untuk penggunaan tingkat lanjut dan detail teknis terbaru.

## Satu gateway untuk backend MCP yang sudah ada

Shared MCP Gateway membuat Copilot hanya memuat antarmuka tetap berisi **6 alat gateway** di awal, lalu mencari dan memanggil alat dari backend yang sudah Anda konfigurasi saat diperlukan. Walaupun katalog berisi sekitar **1.000 alat**, semua definisinya tidak perlu diberikan kepada klien sejak awal.

Katalog dan koneksi backend digunakan kembali oleh beberapa sesi Copilot CLI sehingga mengurangi pengaktifan server lokal yang berulang. Gateway tidak memasang server MCP atau menyediakan kredensial; tetap gunakan cara Anda saat ini untuk mengonfigurasi server dan autentikasi.

Keenam alat tersebut terdiri dari 4 alat penemuan/eksekusi dan 2 alat sewa server umum. Sewa dapat dipakai untuk backend apa pun yang memerlukan status alur kerja eksklusif, bukan hanya untuk otomatisasi browser.

## Prasyarat

- Node.js 24 atau lebih baru, npm, dan Git
- Copilot CLI dengan dukungan plugin
- Konfigurasi MCP Copilot yang sudah ada dan autentikasi yang diperlukan backend
- Agency bersifat opsional dan tidak diperlukan untuk penggunaan Copilot CLI biasa

## Instalasi

Jalankan perintah ini di **terminal**, bukan di dalam percakapan Copilot:

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Kemudian mulai Copilot dan jalankan di dalam Copilot:

```text
/mcp-gateway-setup
```

Memasang plugin saja tidak memigrasikan konfigurasi MCP. Penyiapan menampilkan pratinjau terlebih dahulu; setelah disetujui, penyiapan mencadangkan konfigurasi lama, menyimpan definisi backend dalam direktori privat, dan mengalihkan konfigurasi klien ke konektor gateway bersama.

Simpan jalur cadangan dan perintah pemulihan persis yang ditampilkan. Katalog backend dan cadangan mungkin berisi kredensial; jangan publikasikan atau masukkan ke kontrol versi.

Setelah selesai, tutup lalu buka kembali Copilot. Gateway dimulai otomatis saat konektor pertama kali digunakan; tidak perlu membiarkan terminal lain tetap berjalan.

## Cara kerja

1. `list_servers` menampilkan alias yang dikonfigurasi tanpa memulai semua backend.
2. `search_tools` mencari ringkasan alat yang relevan dalam backend tertentu.
3. `get_tool_schema` hanya mengambil skema input lengkap untuk alat yang dipilih.
4. `call_tool` memvalidasi argumen dan daftar izin sebelum memanggil alat.
5. `claim_server` dan `release_server` melindungi seluruh alur kerja server yang memerlukan akses eksklusif, lalu melepas sewa setelah panggilan aktif selesai.

Klien MCP, gateway, dan server MCP memiliki peran berbeda, tetapi Anda tidak perlu memahami detail protokol untuk penggunaan sehari-hari: konfigurasikan backend seperti biasa dan biarkan Copilot menemukan serta memanggilnya melalui gateway.

## Pembaruan dan pemulihan

Setelah memperbarui plugin, jalankan `/mcp-gateway-setup` untuk mengadopsi runtime baru secara eksplisit. Tunggu hingga panggilan aktif selesai, terapkan pembaruan, lalu buka kembali Copilot; mengunduh plugin saja tidak mengganti gateway yang sedang berjalan.

Jika penyiapan gagal, tutup Copilot dan gunakan jalur cadangan serta perintah pemulihan persis dari output. Jangan hapus direktori backend privat sebagai cara pemulihan.
Lihat [README](../../README.md) berbahasa Inggris untuk sinkronisasi konfigurasi, integrasi klien, sewa, dan pemecahan masalah.

**Lisensi:** [MIT](../../LICENSE)
