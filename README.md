# TKGM Harita Arayüzü

Node.js ile çalışan, CesiumJS tabanlı tam ekran dikey harita arayüzü. Terminal konsolundan koordinat girerek haritada o konuma gidebilirsiniz.

## Kurulum

```bash
npm install
```

### DigitalOcean Spaces (Opsiyonel)

Video/fotoğraflar otomatik olarak DigitalOcean Spaces'e yüklenir. Yükleme başarılıysa sunucudan silinir.

1. [DigitalOcean](https://cloud.digitalocean.com) → Spaces → Create Space
2. API Keys → Generate New Key → Access Key ve Secret Key al
3. `.env` dosyasına ekle:
   - `SPACES_KEY`, `SPACES_SECRET`, `SPACES_BUCKET`, `SPACES_REGION` (örn. `nyc3`)

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
