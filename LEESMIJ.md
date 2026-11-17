# Camper – plekken en ritten

Webapp voor de iPhone die je op je beginscherm zet en die dan werkt als een gewone app.

## Wat de app doet

**Plekken** – kaart van heel Europa met:
- camperplaatsen, campings (alleen die geschikt zijn voor campers), camperparkeerplaatsen, water- en loospunten
- filterknoppen per soort, zoeken op plaatsnaam
- tik op een plek: prijs, aantal plaatsen, stroom/water/lozen/toilet/douche, max. hoogte/lengte/gewicht, openingstijden, telefoon, website
- **Route** opent Apple Kaarten (of Google Maps)
- **Bewaar** zet een plek bij je favorieten. Houd de kaart ingedrukt om een eigen plek toe te voegen.

**Rit** – tik op *Start rit* bij vertrek. Je ziet live je snelheid, kilometers, rijtijd en gemiddelde, en je route wordt op de kaart getekend. Pauze en Stop zitten eronder.

**Ritten** – dashboard met totaal gereden km, rijtijd, km per maand, en een lijst met alle ritten.
Tik op een rit om de route op de kaart te zien. De rit krijgt automatisch een naam ("Dresden → Pirna").
Je kunt ritten exporteren als GPX en een back-up maken/terugzetten.

**Instellingen** – vink per land aan welke plekken je wilt zien (bijv. alleen de landen van je reis).
Met *Download aangevinkte landen* zet je alle plekken van die landen op je telefoon voor gebruik zonder internet.
Hier maak je ook een back-up van je ritten en bewaarde plekken.

## Belangrijk om te weten (iPhone)

- **Houd de app open tijdens het rijden.** Een webapp mag van iOS geen GPS gebruiken als het scherm uit staat of je een andere app opent.
  De app houdt het scherm daarom aan (zet de iPhone in een houder aan de lader). Was de app even weg, dan wordt dat stuk als stippellijn getekend.
- Ritten en bewaarde plekken staan **alleen op je iPhone**. Maak af en toe een back-up (tabblad Ritten).
- Eerder bekeken kaartgebieden en plekken werken ook zonder internet.

## Op je iPhone zetten

De app staat online op **https://beuk-sixty82.github.io/camper/** (GitHub Pages, repository `Beuk-Sixty82/camper`).
1. Open dat adres in **Safari** op je iPhone.
2. Tik op **Deel** → **Zet op beginscherm**.
3. Open de app vanaf het beginscherm en sta **locatie** toe.

Wijzigingen online zetten: `git add -A`, `git commit -m "..."`, `git push`. Na ongeveer een minuut staat de nieuwe versie online.

## Plekkenbestand bijwerken

De plekken komen uit OpenStreetMap en staan in de map `data/`. Opnieuw ophalen (duurt enkele uren, bijvoorbeeld eens per paar maanden):

```bash
node tools/build-data.mjs --fresh
```

Zonder `--fresh` gaat het script verder waar het gebleven was. Het script bepaalt per plek ook het land
(landsgrenzen van Natural Earth, met telefoonnummer/website als hulp vlak bij een grens). Is het plekkenbestand
met een oudere versie gemaakt, voeg de landen dan toe met `node tools/add-countries.mjs`.
De landenlijst voor Instellingen maak je met `node tools/build-countries.mjs`. Voortgang staat in `data-build.log`.
Voor gebieden die (nog) niet in het bestand staan, haalt de app plekken live op bij OpenStreetMap.

## Op de pc bekijken

```bash
node serve.js
```

Open daarna http://localhost:5173.
