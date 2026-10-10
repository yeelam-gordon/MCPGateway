# MCPGateway — Berbagi server MCP lokal antarsesi agen pemrograman

[English](../../README.md)

> Ini adalah ringkasan yang dilokalkan. [README](../../README.md) berbahasa Inggris dan panduan klien berbahasa Inggris yang ditautkan di bawah merupakan sumber resmi untuk instalasi lengkap, peningkatan, dan detail teknis.

Tidak perlu memulai salinan server MCP yang sama untuk setiap sesi Copilot CLI. Gunakan kembali backend lokal yang sudah dikonfigurasi, temukan alat sesuai kebutuhan, dan koordinasikan alur eksklusif. Ini bukan platform tata kelola API perusahaan.

**Prasyarat:** Node.js 24 atau lebih baru, npm, Git, Copilot CLI dengan plugin, serta layanan MCP yang sudah dikonfigurasi dan diautentikasi. Instalasi awal saat ini melalui Copilot CLI; Windows adalah platform utama yang diuji dan Agency opsional. Kompatibilitas dan tingkat verifikasi berbeda antarklien.

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

## Penyiapan dan panggilan pertama

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Setelah instalasi, buka Copilot CLI dan jalankan `/mcp-gateway-setup`. Tinjau pratinjau sebelum menyetujui perubahan yang dimaksud. Tutup dan buka kembali Copilot, lalu jalankan `readinessCommand` persis seperti yang diberikan. Simpan cadangan privat dan perintah pengembalian.
2. Panggil `list_servers` dengan `{}`: alias, status, dan penanda eksklusivitas layanan yang dikonfigurasi seharusnya muncul. Pilih backend yang diizinkan, cari istilah tugas dengan `search_tools`, lalu ambil skema masukan dengan `get_tool_schema`. Siapkan argumen sesuai skema dan lakukan pembacaan yang disetujui melalui `call_tool`. Hasil yang diharapkan adalah data yang diminta atau hasil kosong yang dijelaskan; periksa juga kesalahan, karena menerima respons saja bukan bukti keberhasilan.
3. Jika `requiresExclusiveAccess: true`, gunakan `claim_server` sebelum pencarian dan `release_server` setelah semua panggilan selesai. Backend non-eksklusif tidak perlu diklaim. Jangan ulangi panggilan yang timeout dengan hasil tidak diketahui; tinjau pekerjaan aktif dan koordinasikan mulai ulang. Jika hasilnya tidak diketahui, backend eksklusif tetap diblokir sampai gateway dimulai ulang; melepaskan klaim atau memutus koneksi klien tidak membuka blokir dengan aman. Memutus koneksi tidak membatalkan operasi.

[Contoh lengkap dalam bahasa Inggris](../../README.md#first-use) · [Kompatibilitas](../CLIENTS.md#compatibility-summary)

## Batasan, privasi, dan pemulihan

Menemukan repositori ini melalui Claude Code, Codex, Gemini CLI, Kimi, atau Qwen CLI tidak menjamin integrasi native. Tidak ada jalur instalasi Gemini CLI di sini; Antigravity adalah klien lain. Kimi hanya diuji pada tingkat adapter. Konfigurasi dan cadangan dapat berisi kredensial: jangan publikasikan atau masukkan ke kontrol versi. Backend dapat menghubungi layanan jarak jauh; berbagi bukan berarti offline atau penghematan RAM/token tetap.

Jika daftar kosong, periksa konfigurasi terpilih dan pratinjau migrasi. Jika pencarian kosong, gunakan istilah dalam deskripsi backend. Untuk kegagalan autentikasi atau kesiapan, ikuti referensi operasional, jangan buat proses paralel untuk melewatinya. Memulihkan konfigurasi klien tidak menghentikan runtime persisten; lihat serah terima operator dan pemeriksaan akhir saat berhenti menggunakan gateway.

[Privasi](../REFERENCE.md#state-and-privacy) · [Pemulihan dan pengembalian](../REFERENCE.md#setup-recovery) · [Berhenti dan serah terima operator](../REFERENCE.md#planned-exit)

Penyiapan menampilkan pratinjau sebelum mengubah apa pun. Setelah disetujui, penyiapan membuat cadangan privat serta memberikan pemeriksaan kesiapan dan perintah pengembalian yang tepat. Konfigurasi dan cadangan dapat berisi kredensial; jangan publikasikan atau masukkan ke kontrol versi.

**Referensi operasional (bahasa Inggris):** [Lihat referensi operasional](../REFERENCE.md)

**Lisensi:** [MIT](../../LICENSE)
