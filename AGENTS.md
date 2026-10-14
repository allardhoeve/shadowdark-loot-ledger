# Loot Ledger

Foundry VTT-module voor het Shadowdark-systeem die groepsloot, holdings en overdrachten bijhoudt. Alle code staat in `scripts/add-loot.js` en `styles/add-loot.css`; `module.json` is de bron voor versies en compatibiliteit.

## Projectdocumenten

- **`LOOT_LEDGER_PROJECT_MEMORY.md`**: de bron van waarheid voor besluiten, status en testbevindingen. Lees het vóór elke wijziging aan gedrag of UI, en werk het bij nadat je iets gebouwd of getest hebt, volgens de regels onderaan dat bestand. Zet een punt alleen op ✅ **Besloten** als de gebruiker dat uitdrukkelijk bevestigt.
- **`LOOT_LEDGER_DESIGN.md`**: het ontwerp, afgeleid van het projectgeheugen. Bij een tegenstrijdigheid geldt het projectgeheugen.
- **`CODE_REVIEW.md`**: review van 13 oktober 2026. Regelnummers verlopen; zoek op de geciteerde code.
- **`INSTALLATIE-INSTRUCTIES.txt`**: installatie voor testers, meegeleverd in de test-ZIP.

Documentatie is in het Nederlands; Foundry-, Shadowdark- en UI-termen (Actor, Item, Take Loot) en code-identificaties blijven Engels.

## Foundry- en Shadowdark-gedrag

Controleer API-gedrag in de broncode, niet uit het geheugen:

- `third_party/foundryvtt-shadowdark`: Shadowdark-systeem, git-submodule op de release uit `module.json`.
- `third_party/foundryvtt`: Foundry VTT-app. Niet in git (propriëtair), dus niet op elke machine aanwezig; gebruik anders `resources/app` van de eigen Foundry-installatie.
- `third_party/FoundryVTT-ItemPiles`: Item Piles-module (MIT), als inspiratie. Bekijk hoe zij een oplossing hebben gebouwd bij itemoverdracht tussen Actors, GM-afhandeling via sockets, en Shadowdark-ondersteuning (`systems/shadowdark.js`). Neem code alleen over met naamsvermelding.

## Vaste uitgangspunten

- De module is zelfstandig installeerbaar: alle paden relatief aan de module, en alles werkt in een willekeurige world met willekeurige Actors en gebruikers.
- Slots, stacks en inventory lopen via Shadowdarks eigen logica.
- De beveiliging rond Take Loot-overdrachten blijft zoals ze is totdat de gebruiker een oplossing voor de dubbele overdracht kiest (zie projectgeheugen en `CODE_REVIEW.md`).
- Verhoog `compatibility.verified` in `module.json` pas na een test in die Foundry- of Shadowdark-versie.
