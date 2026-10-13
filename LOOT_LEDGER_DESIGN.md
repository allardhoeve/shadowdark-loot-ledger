# Loot Ledger — ontwerpdocument

**Versie:** 1.0 (eerste ontwerpversie)  
**Status:** De Loot Ledger-module is gebouwd en voorbereid voor privétesten. De hieronder genoemde onderdelen zijn live bevestigd in Foundry: Add Loot en snapshots, Loot-overview, Item Details met Markdown-weergave en automatische vensterhoogte, Take Loot met Shadowdark-slotcontrole, en Treasury-controles tussen GM en speler. Return to Unassigned en Sold zijn niet volledig live regressiegetest; externe installatie is nog niet bevestigd. Het bekende risico op dubbele Take Loot-overdrachten is niet structureel opgelost, daarom is de module nog niet klaar voor openbare distributie of betrouwbaar campagnegebruik.  
**Bron:** `LOOT_LEDGER_PROJECT_MEMORY.md` versie 1.0

## 1. Doel

Loot Ledger houdt bij welke schatten de groep tijdens het spel vindt en waar die loot zich volgens de Ledger bevindt. De Foundry Actor-inventaris blijft de bron van waarheid voor wat een personage op dat moment draagt.

De Ledger bewaart daarnaast een historische registratie van de relevante itemgegevens zoals die waren toen de loot werd toegevoegd. Latere wijzigingen aan het oorspronkelijke Foundry Item veranderen die registratie niet.

## 2. Reikwijdte

Loot Ledger is bedoeld voor het registreren en beheren van groepsloot, holdings, overdrachten en de bijbehorende geschiedenis.

De module is geen algemene personage-inventaris, geen catalogus van alle items en volgt niet automatisch elke handeling met items. Treasury beperkt zich tot de huidige GP, SP en CP; een uitgebreide financiële transactiebalans valt buiten de reikwijdte.

## 3. Loot toevoegen — Add Loot

### Primaire workflow

1. De gebruiker sleept een Foundry Item vanuit een Compendium of Items naar de dropzone **Drag an item here**.
2. Dit opent het **Add Loot**-scherm.
3. Foundry levert itemgegevens, zoals naam, afbeelding, type, slots en stackinformatie.
4. Bij toevoegen neemt de Ledger de relevante itemgegevens over in de historische lootregistratie.

Vooralsnog wordt geen eigen uitgebreide itemzoeker gebouwd.

## 4. Lootregistratie en huidige holdings

Eén lootrecord kan meerdere huidige holdings hebben. Loot kan bijvoorbeeld verdeeld zijn over Actors en één of meer stash-locaties.

Loot die niet door een Actor wordt gedragen, kan als **Stashed** op een fysieke locatie worden bijgehouden. De precieze velden en bediening voor stash-locaties zijn nog niet vastgesteld.

De historische lootregistratie blijft behouden, ook wanneer het oorspronkelijke Foundry Item later wordt gewijzigd. Het oorspronkelijke Foundry Item blijft wel de bron voor het aanmaken en overdragen van het daadwerkelijke item naar een Actor.

## 5. Item Detail

Item Detail bevat drie tabs:

- **Overview** — overzicht van het lootrecord.
- **History** — geschiedenis van dit item.
- **Edit** — aanpassen van campagne- en Ledgergegevens.

History is een eigen tab voor de geschiedenis van het geselecteerde lootrecord en is niet tegelijk permanent zichtbaar in Overview. Er is geen algemene History-tab op het hoofdniveau.

### Edit

Edit wijzigt alleen campagne- en Ledgergegevens, waaronder waarde, found during, location, description en waar relevant quantity. De itemeigenschappen komen van het oorspronkelijke Foundry Item; latere wijzigingen daaraan wijzigen de historische itemgegevens in de Ledger niet.

## 6. Loot overdragen — Take Loot

Take Loot wordt gestart met één knop vanuit **Item Detail**. De gebruiker kiest een Actor en een hoeveelheid.

Bij Shadowdark toont de Ledger:

- huidige slots;
- vrije slots;
- transferkosten;
- resterende vrije slots na de transfer.

Als de Actor onvoldoende ruimte heeft, wordt de transfer geblokkeerd. Bij een succesvolle transfer voegt de Ledger het Foundry Item toe aan de Actor en werkt de Ledger de holdings bij.

**Currently with** is uitsluitend informatief en bevat geen aparte Take-knoppen.

Na overdracht volgt de Ledger niet automatisch het verdere gebruik of verwijderen van het item uit de Actor-inventaris. Nieuwe overdrachten die via de Ledger plaatsvinden, worden wel geregistreerd.

## 7. Treasury

Treasury toont uitsluitend de huidige **GP**, **SP** en **CP**. Een uitgebreide financiële transactiebalans hoort niet bij het ontwerp.

## 8. Visueel uitgangspunt

De meest recente Loot Ledger-mock-up is voorlopig het visuele uitgangspunt:

- compact en leesbaar;
- Shadowdark-geïnspireerd;
- donkere achtergrond;
- parchment-achtige panelen;
- sobere ornamentatie;
- Foundry-itemafbeeldingen.

Visuele details mogen tijdens het prototypen worden aangepast wanneer dat de bruikbaarheid verbetert.

## 9. Niet-doelen

- Een algemene inventaris voor personages.
- Een catalogus of database van alle items.
- Automatisch volgen van elke handeling met items in Actor-inventarissen.
- Een uitgebreide financiële transactiebalans.
- Vooralsnog een eigen uitgebreide itemzoeker.

## 10. Open beslissingen

- Welke Foundry-versie(s) en technische details worden ondersteund?
- Welke concrete tests zijn nodig voordat de module als getest geldt?
- Welke precieze velden en bediening gelden voor stash-locaties? (Het bestaan van holdings op fysieke stash-locaties is besloten; de details zijn nog niet.)

---

Dit document beschrijft het ontwerp. Ontwerpbesluiten moeten overeenkomen met `LOOT_LEDGER_PROJECT_MEMORY.md`; voorstellen blijven ideeën totdat ze daar als besloten zijn vastgelegd.
