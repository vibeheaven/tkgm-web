# TKGM Harita Arayüzü

Node.js ile çalışan, CesiumJS tabanlı tam ekran dikey harita arayüzü. Terminal konsolundan koordinat girerek haritada o konuma gidebilirsiniz.

## Kurulum

```bash
npm install
```

### Google Drive (Opsiyonel)

Video/fotoğraflar otomatik olarak Drive'a yüklenir. Yükleme başarılıysa sunucudan silinir.

1. [Google Cloud Console](https://console.cloud.google.com) → Proje oluştur
2. APIs & Services → Enable APIs → **Google Drive API** etkinleştir
3. Credentials → Create Credentials → **Service Account** → JSON key indir
4. JSON dosyasını `google-credentials.json` olarak proje köküne koy
5. (Opsiyonel) Drive'da klasör oluştur, Service Account email ile **Editor** olarak paylaş → Klasör ID'sini `GOOGLE_DRIVE_ROOT_FOLDER_ID` env ile ver

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
