# MCPGateway — Berbagi server MCP lokal antarsesi agen pemrograman

Tidak perlu memulai salinan server MCP yang sama untuk setiap sesi Copilot CLI. Gunakan kembali backend lokal yang sudah dikonfigurasi, temukan alat sesuai kebutuhan, dan koordinasikan alur eksklusif. Ini bukan platform tata kelola API perusahaan.

- Gunakan bersama RAM dan pekerjaan memulai backend berat, bukan satu salinan per sesi.
- Temukan kemampuan dan skema sesuai kebutuhan lewat 6 alat awal.
- Tambahkan backend sambil mempertahankan koneksi MCP agen. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Tambahkan backend tanpa memulai ulang koneksi MCP agen yang ada: sinkronkan tambahan, selesaikan pekerjaan aktif, lalu mulai ulang hanya gateway milik Anda; konektor saat ini akan terhubung kembali. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Cocok untuk beberapa sesi dengan backend dan katalog yang sama; satu sesi atau backend ringan mungkin tidak sepadan dengan overhead.

[Mulai: instalasi dan pembacaan pertama yang diizinkan](#first-use) · [MCP / Copilot CLI](../CLIENTS.md#shared-core-install) · [6 alat / 2 klien](../../test/catalog-scale.test.js)

[Hindari RAM backend yang berulang](#resource-examples): 5 × 1.5 GB = 7.5 GB → 1.5 GB + overhead gateway dan konektor.

<img src="../../assets/mcp-gateway-benefits.png" alt="Gunakan bersama RAM dan pekerjaan memulai backend berat, bukan satu salinan per sesi." width="780">

Konsep berlabel Inggris, bukan tangkapan layar atau benchmark. Asumsi 1.5 GB per set: 6 GB pengulangan dihindari sebelum overhead. Fixture ringan terukur memakai lebih banyak RAM total.

<a id="first-use"></a>
## Penyiapan dan panggilan pertama

**Prasyarat:** Node.js 24 atau lebih baru, npm, Git, Copilot CLI dengan plugin, serta layanan MCP yang sudah dikonfigurasi dan diautentikasi. Instalasi awal saat ini melalui Copilot CLI; Windows adalah platform utama yang diuji dan Agency opsional. Kompatibilitas dan tingkat verifikasi berbeda antarklien.

Konfigurasi dan cadangan dapat berisi kredensial: simpan secara privat dan setujui hanya perubahan yang dimaksud.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Setelah instalasi, buka Copilot CLI dan jalankan `/mcp-gateway-setup`. Tinjau pratinjau sebelum menyetujui perubahan yang dimaksud. Tutup dan buka kembali Copilot, lalu jalankan `readinessCommand` persis seperti yang diberikan. Simpan cadangan privat dan perintah pengembalian.

Penemuan dan skema tidak memerlukan klaim; jika `requiresExclusiveAccess: true`, gunakan `claim_server` sebelum `call_tool`.

2. Panggil `list_servers` dengan `{}`: alias, status, dan penanda eksklusivitas layanan yang dikonfigurasi seharusnya muncul. Pilih backend yang diizinkan, cari istilah tugas dengan `search_tools`, lalu ambil skema masukan dengan `get_tool_schema`. Siapkan argumen sesuai skema dan lakukan pembacaan yang disetujui melalui `call_tool`. Hasil yang diharapkan adalah data yang diminta atau hasil kosong yang dijelaskan; periksa juga kesalahan, karena menerima respons saja bukan bukti keberhasilan.
3. Jika `requiresExclusiveAccess: true`, gunakan `claim_server` sebelum pemanggilan dan `release_server` setelah semua panggilan selesai. Backend non-eksklusif tidak perlu diklaim. Jangan ulangi panggilan yang timeout dengan hasil tidak diketahui; tinjau pekerjaan aktif dan koordinasikan mulai ulang. Jika hasilnya tidak diketahui, backend eksklusif tetap diblokir sampai gateway dimulai ulang; melepaskan klaim atau memutus koneksi klien tidak membuka blokir dengan aman. Memutus koneksi tidak membatalkan operasi.
4. Pada sesi kedua dengan konektor dan katalog yang sama, ulangi `list_servers` / `search_tools` untuk alias yang sama. Backend terinisialisasi seharusnya `ready` dan pencarian mengembalikan kemampuan katalog yang sama. Alias sama tidak membuktikan identitas proses atau penghematan RAM; lihat uji berbagi publik. [Metode berbagi proses](../BENCHMARK.md#method) · [Uji cache katalog](../../test/catalog-scale.test.js)

[Contoh lengkap dalam bahasa Inggris](../../README.md#first-use) · [Kompatibilitas](../CLIENTS.md#compatibility-summary)

## Batasan, privasi, dan pemulihan

Menemukan repositori ini melalui Claude Code, Codex, Gemini CLI, Kimi, atau Qwen CLI tidak menjamin integrasi native. Tidak ada jalur instalasi Gemini CLI di sini; Antigravity adalah klien lain. Kimi hanya diuji pada tingkat adapter. Konfigurasi dan cadangan dapat berisi kredensial: jangan publikasikan atau masukkan ke kontrol versi. Backend dapat menghubungi layanan jarak jauh; berbagi bukan berarti offline atau penghematan RAM/token tetap.

Jika daftar kosong, periksa konfigurasi terpilih dan pratinjau migrasi. Jika pencarian kosong, gunakan istilah dalam deskripsi backend. Untuk kegagalan autentikasi atau kesiapan, ikuti referensi operasional, jangan buat proses paralel untuk melewatinya. Memulihkan konfigurasi klien tidak menghentikan runtime persisten; lihat serah terima operator dan pemeriksaan akhir saat berhenti menggunakan gateway.

[Privasi](../REFERENCE.md#state-and-privacy) · [Pemulihan dan pengembalian](../REFERENCE.md#setup-recovery) · [Berhenti dan serah terima operator](../REFERENCE.md#planned-exit)

Penyiapan menampilkan pratinjau sebelum mengubah apa pun. Setelah disetujui, penyiapan membuat cadangan privat serta memberikan pemeriksaan kesiapan dan perintah pengembalian yang tepat. Konfigurasi dan cadangan dapat berisi kredensial; jangan publikasikan atau masukkan ke kontrol versi.

**Referensi operasional (bahasa Inggris):** [Lihat referensi operasional](../REFERENCE.md)

**Lisensi:** [MIT](../../LICENSE)


<a id="resource-examples"></a>

**Hindari RAM backend yang berulang**

Asumsi ilustratif, bukan benchmark: 5 sesi masing-masing membutuhkan 12 koneksi yang sama; satu set backend lengkap memakai 1.5 GB. Sesi yang kompatibel berbagi proses nyata melalui konektor dan katalog yang sama.

| Penerapan | RAM backend |
|---|---|
| Salinan terpisah | 5 × 1.5 GB = 7.5 GB |
| Satu set bersama | 1.5 GB + overhead gateway dan konektor |

RAM backend berulang yang dihindari sebelum overhead: 7.5 GB - 1.5 GB = 6 GB. Penghematan total belum diketahui hingga diukur. 1.5 GB bukan nilai tetap lintas beban atau klien; ini bukan RAM lima model.

**Gunakan ulang pekerjaan memulai backend juga.** Jika kelima sesi memakai semua 12 layanan stdio, salinan terpisah memerlukan hingga `5 × 12 = 60` kali mulai, dibanding `12` bersama: `60 - 12 = 48` pengulangan dihindari, `48 / 60 × 100 = 80%` lebih sedikit. Koneksi sesuai kebutuhan hanya menghubungkan `k` backend terpakai; yang tidak dipakai tidak dimulai. Ini jumlah operasi, bukan waktu mulai 80% lebih cepat. Latensi belum diukur; konkurensi, autentikasi, dan platform memengaruhi waktu.

1000 alat → 6 definisi awal: (1000 - 6) / 1000 × 100 = 99.4% lebih sedikit definisi, bukan token. Skema yang diminta kemudian tetap memiliki biaya; klien yang sudah menunda pemuatan bisa mendapat manfaat lebih kecil. Uji katalog sintetis memverifikasi enam alat dan cache penemuan bersama untuk dua klien, bukan kinerja RSS. [catalog-scale.test.js](../../test/catalog-scale.test.js)

**Fixture ringan terukur: berbagi bekerja, tetapi RAM total lebih buruk dan mulai dingin tidak lebih cepat.** Median 3 percobaan, Windows x64 / Node 24.13.1: skema + echo bersama 426.2 ms untuk backend dingin, 21.1 ms klien kedua, 19.0 ms kelima. Total klien pertama: langsung 503.5 ms, bersama dengan gateway siap 894.3 ms; mulai bersama sepenuhnya dingin 1886.7 ms. Proses backend 5 → 1, tetapi total proses 5 → 7 dan jumlah working set 357.0 MiB → 564.0 MiB: RAM bersih lebih buruk. Satu echo tidak mewakili layanan nyata berat; 1.5 GB di atas adalah asumsi terpisah, bukan pengukuran. [BENCHMARK.md](../BENCHMARK.md)

<a id="mechanism"></a>

Uji SDK/stdio mempertahankan konektor dan koneksi MCP untuk menemukan alias baru dan menjalankan echo setelah mulai ulang; UI percakapan tiap produk tidak diuji. Bukan hot reload otomatis; konflik perlu ditinjau. Registrasi awal atau upgrade runtime mungkin perlu mulai ulang klien. Panggilan terputus tidak diulang; klaim ulang akses eksklusif setelah mulai ulang.

```text
Agen A ─┐                         ┌─ Integrasi A: banyak alat
Agen B ─┼─ konektor ─ MCPGateway ─┼─ Integrasi B: banyak alat
Agen C ─┘                         └─ Integrasi C: banyak alat
```

Beberapa agen mengakses MCPGateway melalui konektor yang sama; koneksi ke backend terkonfigurasi yang dipilih dibuat sesuai kebutuhan. Diagram ini menjelaskan mekanisme berbagi, bukan benchmark atau bukti pengujian saat berjalan, dan tidak berarti semua backend dimulai.

> Ini adalah ringkasan yang dilokalkan. [README](../../README.md) berbahasa Inggris dan panduan klien berbahasa Inggris yang ditautkan di bawah merupakan sumber resmi untuk instalasi lengkap, peningkatan, dan detail teknis.

[English](../../README.md)

Gateway selalu menampilkan 6 alat kepada agen: 4 untuk menemukan dan memanggil kemampuan, serta 2 untuk integrasi yang memerlukan alur kerja eksklusif. Menambah koneksi tidak memperbesar antarmuka awal ini; skema lengkap hanya dimuat untuk alat yang dipilih. Koneksi yang sudah Anda konfigurasi dan autentikasi digunakan kembali, tanpa memasang layanan atau menyediakan kredensial.

Misalnya, **10** koneksi Copilot ditambah **2** koneksi baru yang dimigrasikan secara eksplisit dari konfigurasi Claude yang didukung dapat menjadi **12** koneksi bersama bagi kedua agen.

- Plugin saja tidak menggabungkan konfigurasi. Entri bernama sama hanya dideduplikasi jika definisi alias identik; layanan tujuan yang sama tidak cukup. Konflik menghentikan proses untuk ditinjau.
- Migrasi menampilkan pratinjau, membuat cadangan, dan menolak pengaturan native yang tidak didukung.
- Ini bukan bukti bahwa semua klien native telah diuji dari awal hingga akhir. [Panduan migrasi (bahasa Inggris)](../CLIENTS.md#cross-client-migration).

| Klien | Instalasi | Peningkatan |
|---|---|---|
| GitHub Copilot CLI | [Instal](../CLIENTS.md#copilot-cli-install) | [Tingkatkan](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code (editor) | [Instal](../CLIENTS.md#vs-code-install) | [Tingkatkan](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Instal](../CLIENTS.md#claude-code-install) | [Tingkatkan](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Instal](../CLIENTS.md#codex-install) | [Tingkatkan](../CLIENTS.md#codex-upgrade) |
| OpenCode | [Instal](../CLIENTS.md#opencode-install) | [Tingkatkan](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Instal](../CLIENTS.md#qwen-code-install) | [Tingkatkan](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Instal](../CLIENTS.md#kimi-cli-install) | [Tingkatkan](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Instal](../CLIENTS.md#antigravity-cli-install) | [Tingkatkan](../CLIENTS.md#antigravity-cli-upgrade) |
