# IHC Portal Klien — Versi GitHub Pages

Versi statis (HTML, CSS, JavaScript murni) dari **IHC Portal Klien** yang siap langsung di-host di **GitHub Pages** (`https://username.github.io/nama-repo/`) tanpa proses build.

Semua fitur, tema, dan koneksi Firebase/Firestore sama persis dengan `web-client-portal/`, menggunakan path relatif (`./`) serta file `.nojekyll`.

## Langkah Upload ke GitHub Pages

1. **Buat Repository Baru di GitHub**
   - Masuk ke GitHub dan buat repository baru (misalnya `ihc-portal-klien`), bisa **Public** maupun **Private** (sesuai paket GitHub Anda).
2. **Upload Isi Folder Ini**
   - Upload seluruh isi folder `web-client-portal-github/` ke root repository GitHub tersebut (pastikan file `index.html`, `.nojekyll`, `app.js`, `styles.css`, `firebase-config.js`, dan folder `assets/` berada langsung di root branch repository, bukan di dalam sub-folder).
3. **Aktifkan GitHub Pages**
   - Buka tab **Settings → Pages** di repository GitHub Anda.
   - Pada **Build and deployment → Source**, pilih **Deploy from a branch**.
   - Pilih branch `main` (atau `master`) dan folder `/ (root)`, lalu klik **Save**.
   - Tunggu 1–2 menit hingga alamat situs `https://username.github.io/nama-repo/` muncul dan aktif.
4. **Daftarkan Domain GitHub Pages di Firebase Authentication**
   - Buka **Firebase Console → Authentication → Settings → Authorized domains**.
   - Klik **Add domain** dan tambahkan domain GitHub Pages Anda (contoh: `username.github.io`), lalu simpan agar login Email/Password berjalan lancar.
