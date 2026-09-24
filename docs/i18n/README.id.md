# Shared MCP Gateway

[English](../../README.md)

> Ini adalah ringkasan yang dilokalkan. [README](../../README.md) berbahasa Inggris dan panduan klien berbahasa Inggris yang ditautkan di bawah merupakan sumber resmi untuk instalasi lengkap, peningkatan, dan detail teknis.

## Hemat RAM. Sisakan konteks untuk pekerjaan Anda. Alat sesuai kebutuhan.

**Lebih banyak agen seharusnya berarti lebih banyak pekerjaan selesai, bukan lebih banyak salinan konfigurasi MCP yang sama.**

### 5 agen. 12 koneksi MCP. Satu konfigurasi bersama.

*Contoh ilustratif: **12** koneksi tersebut menyediakan **1,000** alat dan setiap konfigurasi mandiri menggunakan **1.5 GB** RAM proses lokal.*

| Manfaat | Konfigurasi terpisah per agen | Dengan MCPGateway |
|---|---|---|
| **Hemat RAM** | **7.5 GB** untuk lima konfigurasi MCP mandiri. | **1.5 GB digunakan bersama**, ditambah overhead gateway/konektor. **6 GB memori duplikat dihindari.** |
| **Sisakan konteks. Alat sesuai kebutuhan.** | Setiap agen memuat **1,000 definisi alat** di awal; jumlahnya dapat bertambah saat koneksi MCP ditambahkan. | Hanya **6 alat gateway di awal—99.4% lebih sedikit definisi**. Semua **1,000** alat tetap tersedia; setiap agen hanya menemukan dan memuat yang diperlukan. Tambahkan koneksi tanpa memuat seluruh katalognya ke setiap agen. |

**Pertahankan agen dan koneksi MCP Anda. Jangan buat setiap sesi membawa salinannya sendiri.**

*Angka RAM hanya ilustrasi, bukan penghematan terukur; memori agen merupakan tambahan. Jumlah definisi bukan penghematan token, dan klien yang sudah menunda pemuatan mungkin mendapat manfaat konteks lebih kecil. Berbagi tidak memperbesar jendela konteks model atau membuat total penggunaan RAM tetap.*

## Cara kerja

Gateway selalu menampilkan 6 alat kepada agen: 4 untuk menemukan dan memanggil kemampuan, serta 2 untuk integrasi yang memerlukan alur kerja eksklusif. Menambah koneksi tidak memperbesar antarmuka awal ini; skema lengkap hanya dimuat untuk alat yang dipilih. Koneksi yang sudah Anda konfigurasi dan autentikasi digunakan kembali, tanpa memasang layanan atau menyediakan kredensial.

**Prasyarat:** Node.js 24 atau lebih baru, npm, Git, dan Copilot CLI dengan dukungan plugin untuk proses awal saat ini. Agency bersifat opsional.

## Instalasi dan peningkatan berdasarkan klien

Runtime bersama saat ini dibuat melalui Copilot CLI; klien lain terhubung ke konektor stabil yang sama. Tautan berikut membuka panduan klien berbahasa Inggris, sumber resmi untuk instalasi dan peningkatan.

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

Penyiapan menampilkan pratinjau sebelum mengubah apa pun. Setelah disetujui, penyiapan membuat cadangan privat serta memberikan pemeriksaan kesiapan dan perintah pengembalian yang tepat. Konfigurasi dan cadangan dapat berisi kredensial; jangan publikasikan atau masukkan ke kontrol versi.

**Referensi operasional (bahasa Inggris):** [Lihat referensi operasional](../REFERENCE.md)

**Lisensi:** [MIT](../../LICENSE)
