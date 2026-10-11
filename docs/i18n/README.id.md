# MCPGateway — Berbagi backend MCP lokal antarsesi pemrograman

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Beberapa sesi memakai satu set backend: hindari memori duplikat dan pekerjaan inisialisasi berulang. Jalur SDK/stdio yang diuji mempertahankan koneksi MCP saat menambah konfigurasi (koneksi yang sudah ada dari agen Anda ke gateway).

[Mulai](#first-use) · [Kompatibilitas (Inggris)](../CLIENTS.md#compatibility-summary) · [Bukti dan batasan (Inggris)](../BENCHMARK.md) · [Pembaruan Copilot](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="Salinan backend menjadi satu set bersama; proses mulai digunakan ulang; dalam eksperimen SDK/stdio, koneksi MCP tetap ada saat gateway milik sendiri dimulai ulang setelah pekerjaan selesai." width="780">

Ilustrasi konsep dengan label Inggris, bukan tangkapan layar atau benchmark. [SVG](../../assets/mcp-gateway-benefits.svg)

- **Hindari memori backend duplikat:** Dengan asumsi 5 × 1.5 GB dibagikan menjadi satu set, duplikasi 6 GB dihindari **sebelum** overhead gateway/konektor. Bukan penghematan bersih terukur.
- **Gunakan ulang pekerjaan memulai backend:** Jika kelima sesi memakai kedua belas layanan stdio, jumlah peluncuran backend menjadi 60 → 12. Bukan berarti waktu inisialisasi 80% lebih cepat.
- **Pertahankan koneksi MCP yang ada:** Eksperimen SDK/stdio mempertahankan koneksi setelah hanya menambah konfigurasi lalu memulai ulang gateway milik sendiri saat pekerjaan selesai. Bukan hot reload, kelanjutan panggilan aktif, atau bukti semua UI percakapan native. Registrasi awal dan upgrade runtime mungkin perlu mulai ulang klien. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**Gunakan atau lewatkan:** Untuk beberapa sesi dengan konektor dan katalog yang sama. MCP langsung mungkin lebih sederhana bagi satu sesi atau backend ringan. Uji ringan menaikkan jumlah working set proses dari 357.0 → 564.0 MiB; permintaan bersama pertama, dari memulai gateway baru hingga hasil berguna pertama, memerlukan 1886.7 ms dibanding langsung 503.5 ms. Manfaat bersih bergantung pada overhead. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## Hasil berguna pertama: pembacaan yang diizinkan melalui gateway

Perlu Node.js 24+, npm, Git, Copilot CLI dengan plugin, serta integrasi MCP yang sudah dikonfigurasi dan diautentikasi. Instalasi awal melalui Copilot CLI; Windows adalah platform utama yang diuji. Verifikasi berbeda antarklien. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**Sebelum menginstal:** Konfigurasi, katalog privat dan cadangan dapat berisi kredensial: jangan publikasikan. Backend dapat menghubungi layanan jarak jauh. Runtime persisten dipasang; pemulihan konfigurasi atau penghapusan plugin tidak menghentikan gateway. [REFERENCE](../REFERENCE.md#planned-exit) Status privat lokal dan token gateway tersimpan hanya dapat diakses pemilik, tanpa enkripsi tambahan.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Buka Copilot CLI dan jalankan `/mcp-gateway-setup`. Tinjau pratinjau dan setujui hanya perubahan yang diinginkan. Simpan cadangan privat dan perintah pengembalian. Plugin saja tidak menggabungkan konfigurasi.
2. Tutup dan buka kembali Copilot; jalankan `readinessCommand` persis seperti yang dikembalikan menurut petunjuk objek perintah. Perintah pemeriksaan tidak memulai gateway yang belum berjalan. [readinessCommand](../REFERENCE.md#readiness-command-object) Simpan hanya objek JSON yang dikembalikan; `.command` adalah program yang disetujui dan `.args` adalah argumen persis dalam urutan aslinya.
3. Pilih pembacaan yang tidak berbahaya dan diizinkan pada integrasi yang ada. Ganti hanya tugas dalam kurung; ambil alias, alat dan argumen dari penemuan serta skema, jangan menebak.

> Gunakan gateway untuk [tugas baca saya yang diizinkan]. Jalankan `list_servers`, pencarian terarah dengan `search_tools` dan `get_tool_schema`; siapkan argumen sesuai skema memakai nilai uji yang diizinkan dan tidak sensitif. Dapatkan persetujuan normal. Jika `requiresExclusiveAccess: true`, gunakan sekali `claim_server` sebelum `call_tool`, lalu `release_server` setelah semua panggilan selesai; backend non-eksklusif tidak perlu klaim. Tampilkan data sebenarnya atau hasil kosong terdokumentasi dan periksa kesalahan, bukan hanya respons gateway. Jika hasil tidak diketahui, jangan ulangi: biarkan diblokir dan serahkan secara privat kepada pemilik instalasi.

4. Di sesi kedua dengan konektor dan katalog yang sama, cari alias yang sama: harapkan `ready` dan kemampuan yang sama. Ini memeriksa penemuan bersama, bukan identitas proses atau penghematan RAM. [MCP](../REFERENCE.md#first-shared-workflow) [Contoh echo publik dan hasil](../REFERENCE.md#public-echo-illustration).

**Jika gagal:** Katalog kosong: periksa konfigurasi dan pratinjau; cari istilah dari deskripsi backend. Ikuti referensi untuk autentikasi atau kesiapan, tanpa proses pintasan. Melepas klaim atau memutus koneksi tidak membatalkan atau membuka blokir hasil eksklusif tak diketahui secara aman. Cocokkan hasil, koordinasikan mulai ulang gateway milik sendiri, lalu klaim lagi. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**Berhenti menggunakan:** Selesaikan pekerjaan dan panggilan, pulihkan atau hapus konektor klien terkait, kemudian ikuti serah terima operator untuk memverifikasi gateway milik sendiri berhenti. Pengembalian konfigurasi bukan penghentian proses. Pertahankan status privat, kredensial, riwayat dan proses lain. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
Ini ringkasan lokal. Metode, asal angka dan rincian operasi ada dalam panduan Inggris. Dukungan klien native bukan sertifikasi pemahaman manusia atas terjemahan ini. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
