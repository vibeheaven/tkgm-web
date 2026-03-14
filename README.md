# TKGM Harita Arayüzü

Node.js ile çalışan, CesiumJS tabanlı tam ekran dikey harita arayüzü. Terminal konsolundan koordinat girerek haritada o konuma gidebilirsiniz.

## Kurulum

```bash
npm install
```

### Google Drive (Opsiyonel)

Video/fotoğraflar otomatik olarak Drive'a yüklenir. Yükleme başarılıysa sunucudan silinir.

**ÖNEMLİ (Nisan 2025 sonrası):** Yeni Service Account'lar "My Drive" paylaşılan klasörlere yükleyemez. **Shared Drive (Takım Sürücüsü)** zorunlu.

1. [Google Cloud Console](https://console.cloud.google.com) → Proje → APIs & Services → **Google Drive API** etkinleştir
2. Credentials → **Service Account** → JSON key indir → `google-credentials.json` proje köküne koy
3. **drive.google.com** → Sol menü **"Takım sürücüleri" / "Shared drives"** → Yeni takım sürücüsü oluştur
4. Takım sürücüsüne sağ tık → **Üyelere ekle** → Service Account email (`xxx@xxx.iam.gserviceaccount.com`) → **İçerik yöneticisi**
5. Takım sürücüsü veya içindeki klasör URL'sinden ID al: `.../folders/1abc...xyz`
6. `GOOGLE_DRIVE_ROOT_FOLDER_ID=1abc...xyz` (server.js'de varsayılan var)

## Çalıştırma

```bash
npm start
```

1. Tarayıcıda **http://localhost:3000** adresini açın
2. Terminalde koordinat girin (enlem boylam formatında)
3. Harita otomatik olarak o konuma uçacak

## Koordinat Formatları

- `41.0082 28.9784` - İstanbul
- `39.9334 32.8597` - Ankara
- `41.0082, 28.9784` - virgül ile de yazılabilir
- `goto 41.0082 28.9784` - goto öneki ile

## Çıkış

Terminalde `q` veya `exit` yazarak sunucuyu kapatabilirsiniz.
