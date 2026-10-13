# Loot Ledger — projectgeheugen

Dit bestand is de korte, actuele bron van waarheid voor het project. Ideeën uit brainstorms en gesprekken zijn pas onderdeel van het ontwerp nadat ze hier als besloten zijn vastgelegd.

## Status

**Scopewijziging besloten op 12 oktober 2026:** voor dinsdagavond **13 oktober 2026** richten we ons op een bruikbare, zelfstandig installeerbare basisversie waarmee DM's loot toevoegen en spelers loot zelfstandig zien en nemen. **Stash is uitgesteld** en staat in `LOOT_LEDGER_IDEAS.md`. De onderstaande bouw- en testbevindingen blijven historische bevindingen; ze bevestigen niet dat alle vereisten van deze basisversie al zijn getest.

**Ontwerp vastgelegd. De Loot-overview, Add Loot-workflow, Item Detail en Take Loot zijn gebouwd en getest. De technische proeven voor Actor-itemoverdracht/Shadowdark-slots en Item-snapshot zijn eveneens getest.**

**Huidige beperking:** een structureel probleem met dubbele Take Loot-overdrachten is nog niet opgelost. De module is daarom nog niet betrouwbaar genoeg om als basisversie te publiceren.

### Privétestpakket

- 🛠️ `loot-ledger-test.zip` is gemaakt uit de actieve module, niet uit staging. Het staat in `C:\Users\sande\.codex\.chatgpt-projects\g-p-6abbff53f0e88191a0f8c2d28b862b41\loot-ledger-test.zip`; de bijbehorende `INSTALLATIE-INSTRUCTIES.txt` staat ernaast.
- De ZIP bevat drie bestanden onder `loot-ledger/`: `module.json`, `scripts/add-loot.js` en `styles/add-loot.css`. Uitpakken, manifestverwijzingen en JavaScript-syntaxis zijn gecontroleerd; er zijn geen absolute ontwikkelpaden aangetroffen.
- Het manifest vermeldt Foundry VTT 14.368 en Shadowdark 4.0.6. De ZIP is bedoeld voor privétesten. Een installatie door een externe tester is nog niet bevestigd.

### Tijdelijke testafspraak voor overdrachten

- Voorlopig gebruiken we maximaal één actieve GM-client bij het testen van overdrachten. Een afzonderlijke spelerclient met een ander Foundry-gebruikersaccount mag actief zijn.
- Dit is een handmatige testafspraak, geen technische beveiliging of definitieve ontwerpbeslissing.
- De module kan momenteel niet betrouwbaar vaststellen of dezelfde GM-gebruiker meerdere clients heeft geopend.

### Openstaand technisch probleem: dubbele Take Loot-overdracht

- Tijdens een multiplayer Take Loot-test ontstonden twee Actor-items met dezelfde `recordId` en `transferId`, terwijl de Ledger één overgedragen item registreerde.
- **Return to Unassigned** blokkeerde terecht vanwege de dubbele koppeling. De bestaande dubbele Arrows-items bij Henk blijven onaangeroerd.
- Dubbele verwerking door twee GM-clients met hetzelfde gebruikers-ID is een aannemelijke oorzaak die in geïsoleerde tests is gereproduceerd, maar niet definitief bewezen voor het oorspronkelijke incident. De testwereld is later voor een reset aangewezen; de huidige Actor-inventarissen en lootrecords zijn in deze actualisatie niet live uitgelezen, dus de oude Henk-testitems mogen niet als actuele toestand worden aangenomen.
- De bestaande beveiliging tegen ambigue Actor-itemkoppelingen blijft behouden.
- De structurele oplossing voor dubbele overdrachten is een openstaand technisch probleem en is noodzakelijk voordat de module als betrouwbaar kan worden gepubliceerd.
- Voorlopig richten we ons op het afronden van de minimale bruikbare versie. De overdrachtsbeveiliging wordt niet gewijzigd voordat een veilige oplossing is vastgesteld.

## Officiële scope van de basisversie

- ✅ **Doel:** een bruikbare basisversie delen met spelers voor dinsdagavond **13 oktober 2026**.
- ✅ DM's kunnen loot toevoegen via de bestaande **Add Loot**-workflow.
- ✅ Spelers kunnen de beschikbare loot zien en zelfstandig via **Take Loot** een Actor en hoeveelheid kiezen en loot nemen, zonder dat de DM iedere overdracht handmatig hoeft uit te voeren.
- ✅ De bestaande **Shadowdark-slotcontrole** blijft vereist: toon de slotinformatie en blokkeer een overdracht bij onvoldoende ruimte, met Shadowdarks eigen inventory-, slot- en stacklogica.
- ✅ Een geslaagde overdracht voegt de juiste hoeveelheid van het juiste Foundry Item aan de gekozen Actor-inventaris toe en werkt de Ledger-holdings consistent bij. Een geblokkeerde of mislukte overdracht mag geen onjuiste inventaris of holdings achterlaten.
- ✅ Lootgegevens en holdings blijven bewaard na herladen of opnieuw starten van de wereld.
- ✅ De basisversie moet betrouwbaar werken met meerdere verbonden clients: wijzigingen worden gedeeld en gelijktijdig nemen van loot mag niet tot dubbele overdrachten of onjuiste resterende hoeveelheden leiden.
- ✅ De module is zelfstandig te installeren en te gebruiken op een andere Foundry-installatie, zonder afhankelijkheid van de ontwikkelcomputer of diens specifieke world, Actors en gebruikers.
- ✅ **Stash valt buiten deze basisversie.** Het bewaren van loot op fysieke stash-locaties en de bijbehorende Stash-acties worden later opgepakt. De bestaande Stash-ontwerpbesluiten hieronder blijven bewaard als uitgangspunt voor dat uitgestelde onderdeel; ze zijn geen huidige vereisten voor deze basisversie.
- ✅ Bestaande code wordt niet onnodig verwijderd vanwege deze scopebeperking.
- ✅ Overige ontwerpbeslissingen blijven intact. Deze scopewijziging verplicht niet tot het afronden van overige nog niet gebouwde onderdelen voor deze basisversie.

De gebruiker heeft nog aanvullende wijzigingen die later besproken worden. Die zijn nog niet besloten en maken nog geen deel uit van de huidige scope. De genoemde deadline is een doel, geen bevestiging dat de basisversie al gereed is.

## Statuslabels

- 💡 **Idee** — voorstel, nog geen toezegging
- 🔍 **Onderzocht** — nagegaan, maar nog niet besloten
- ✅ **Besloten** — bevestigd ontwerpbesluit
- 🛠️ **Gebouwd** — aanwezig in de module
- 🧪 **Getest** — gecontroleerd in Foundry
- ❌ **Afgewezen** — bewust buiten het ontwerp gehouden

## Bevestigde ontwerpbesluiten

### Doel en uitgangspunten

- ✅ Loot Ledger houdt bij welke schatten de groep tijdens het spel vindt.
- ✅ De inventarissen van Foundry-personages blijven de bron van waarheid voor wat personages op dat moment bij zich dragen.
- ✅ Dit project heet **Loot Ledger**. Verwijzingen naar andere, oudere modules worden zo veel mogelijk vermeden.

- ✅ Loot Ledger is een zelfstandige Foundry VTT-module die op andere Foundry-installaties kan worden geïnstalleerd en gebruikt. De module is niet afhankelijk van lokale bestanden, absolute bestandspaden, specifieke worlds, actors, gebruikers of andere toevallige configuratie op de ontwikkelcomputer. De lokale Foundry-installatie dient uitsluitend als ontwikkel- en testomgeving.

### Add Loot

- ✅ De primaire workflow is een Foundry Item vanuit een Compendium of Items naar de dropzone **Drag an item here** slepen. Dit opent het **Add Loot**-scherm.
- ✅ Vooralsnog bouwen we geen eigen uitgebreide itemzoeker.
- ✅ Foundry levert de itemgegevens, zoals naam, afbeelding, type, slots en stackinformatie.
- ✅ Bij het toevoegen van loot neemt de Ledger de relevante itemgegevens over als onderdeel van de historische lootregistratie. Latere wijzigingen aan het oorspronkelijke Foundry Item veranderen de historische lootregistratie niet.

### Gebouwd en getest: Add Loot

- 🛠️ **Gebouwd:** De dropzone **Drag an item here** accepteert Foundry Items uit zowel Compendiums als World Items en opent het Add Loot-scherm.
- 🛠️ **Gebouwd:** Het scherm toont Foundry-itemgegevens alleen-lezen en laat de afgesproken campagnegegevens invoeren. Loot-records worden in de wereld opgeslagen met een zelfstandige historische snapshot van relevante Item-data en de oorspronkelijke Item-ID/UUID als technische bronverwijzing.
- 🧪 **Getest:** De opgeslagen snapshot bleef onveranderd na een wijziging aan het oorspronkelijke World Item. De records bleven behouden nadat de wereld opnieuw was geladen. Shadowdark-slotinformatie, waaronder `slots.slots_used`, werd correct uit de bestaande Shadowdark-data gelezen.
- 🧪 **Getest:** Add Loot is getest in Foundry VTT 14 build 368 met Shadowdark 4.0.6.
- **Beperking van de test:** Het oorspronkelijke Compendium Item kon niet rechtstreeks worden gewijzigd omdat het Shadowdark Gear-Compendium vergrendeld was. Snapshot-onafhankelijkheid is wel rechtstreeks getest met een World Item.

### Gebouwd en getest: Loot-overview

- 🛠️ **Gebouwd:** De Loot-overview toont één rij per lootrecord en geeft records uit de bestaande opslag weer.
- 🧪 **Getest:** Een nieuw record dat via Add Loot werd opgeslagen verscheen direct in de overview en bleef zichtbaar na het herladen van de wereld.
- 🧪 **Getest:** **Unassigned** en de historische **Found during**- en **Location**-gegevens werden correct weergegeven.
- 🧪 **Getest:** Een nieuw Compendium-record voor **Arrows ×21** verscheen direct met de ingevoerde vindlocatie en waarde (**5 gp**) en bleef na herladen zichtbaar. Na Take Loot toonde de overview **Henk 21**; de bestaande records, waaronder het eerder toegewezen **Arrows ×2 / Henk 2**, bleven intact.

### Gebouwd en getest: Item Detail

- 🛠️ **Gebouwd:** Item Detail opent het geselecteerde record vanuit de Loot-overview en bevat de tabs **Overview**, **History** en **Edit**.
- 🧪 **Getest:** Het juiste record opent vanuit de overview en alle drie de tabs zijn bereikbaar. **History** toont de afgesproken lege toestand.
- 🧪 **Getest:** Een campagnegegeven kon worden aangepast, opgeslagen en na herladen teruggevonden. De historische snapshotgegevens en bronverwijzing bleven onaangetast.
- 🧪 **Getest:** Quantity en holdings bleven consistent; het record toonde **Unassigned 1**.
- 🧪 **Getest:** Een World Item-drop opent **Add Loot**. Na annuleren was geen extra record aangemaakt; de overview en de drie bestaande records bleven zichtbaar.
- 🧪 **Getest:** De standaard Foundry-sluitknop sloot Item Detail en Loot Ledger. De JavaScript-syntaxiscontrole slaagde.
- **Nog niet gebouwd:** Stash-acties. Een algemene History-tab op het hoofdniveau hoort niet meer bij het huidige ontwerp.

### Gebouwd en getest: Take Loot

- 🛠️ **Gebouwd:** Vanuit Item Detail kan de gebruiker een Actor en hoeveelheid kiezen. De module toont Shadowdark-slots en blokkeert bevestiging wanneer de Actor onvoldoende ruimte heeft.
- 🧪 **Getest:** **Arrows ×21** overgedragen naar Henk. Vooraf: **5/10 slots**, **5 vrij**, transferkosten **2**, daarna **3 vrij**. Na afloop stond de nieuwe Arrows-stack als **21/20** in Henks inventaris en gebruikte deze **2 slots**; totaal **7/10**. De Ledger-holding werd **Henk 21**.
- 🧪 **Getest:** Na herladen bleven de Ledger-holding **Henk 21** en Henks inventorystatus **7/10** behouden. De eerder aanwezige Items (Torch ×1, Arrows ×21 en twee Arrows ×1) bleven staan; de twee Arrows ×1 die al bij de Actor aanwezig waren, zijn niet gewijzigd.
- 🧪 **Getest:** Met Henk op **7/10** slots en **3 vrij** blokkeerde de module een overdracht van **79 Arrows**: Shadowdark-berekening **4 slots**, resterend **−1 (11/10)**. De bevestigingsknop was uitgeschakeld en de melding gaf onvoldoende ruimte aan; de Actor-inventaris en holdings veranderden niet.
- 🧪 **Getest:** Het tijdelijke testrecord werd na de capaciteitstest teruggezet van quantity found **100** naar **21**. De holdings bleven **Henk 21**. Na herladen was het record **Arrows ×21 / Henk 21 / 5 gp**.
- 🧪 **Getest in:** Foundry VTT 14 build 368 met Shadowdark 4.0.6.

### Gebouwd en getest: UI-opruiming en herstel

- 🛠️ **Gebouwd:** De redundante onderste **Close**-balk is verwijderd; de standaard Close-knop van Foundry blijft beschikbaar.
- 🛠️ **Gebouwd:** De bruine teller rechtsboven is verwijderd nadat was vastgesteld dat deze overbodig was.
- 🧪 **Getest:** Na herstel opent de Ledger weer. De standaard Close-knop sluit het venster, waarna de Ledger opnieuw kan worden geopend. **Add Loot** opent voor een World Item. De huidige testronde bevestigde opnieuw dat de overview, itemselectie, Item Detail-tabs, Edit-opslag en Add Loot-ingang beschikbaar blijven.
- 🧪 **Getest:** Foundry VTT 14 `Dialog` vereist een `buttons`-object tijdens het renderen, ook wanneer de dialoog geen eigen knoppen definieert. `buttons: {}` moet daarom aanwezig blijven; zonder dit object ontstond `TypeError: Cannot convert undefined or null to object` voordat de Ledger opende. Het terugzetten van `buttons: {}` herstelde het openen van de Ledger zonder de onderste balk terug te brengen.
- **Beperking van de diagnose:** De browserconsole kon niet rechtstreeks worden uitgelezen. Het Foundry-serverlog bevatte een `ELOCKED`-melding bij een startpoging; dit was niet de bevestigde oorzaak van de Dialog-renderfout. Die foutoorzaak is vastgesteld aan de hand van Foundry’s Dialog-code en de werking na herstel.
### Item Detail, Edit en History

- ✅ Item Detail bestaat uit de tabs **Overview**, **History** en **Edit**. History is dus niet permanent zichtbaar in Overview.
- ✅ Geschiedenis is alleen beschikbaar in de **History**-tab van Item Detail; er is geen algemene History-tab op het hoofdniveau.
- ✅ **Edit** wijzigt alleen campagne- en Ledgergegevens, zoals waarde, found during, location, description en waar relevant quantity. De vastgelegde historische itemgegevens veranderen niet door latere wijzigingen aan het oorspronkelijke Foundry Item. Dat oorspronkelijke Foundry Item blijft wel de bron voor het aanmaken en overdragen van het daadwerkelijke item naar een Actor.
- 🛠️ **Gebouwd:** Item Details tonen afbeelding links, naam en beschrijving rechts en de overige gegevens eronder. Description-weergave ondersteunt alinea's, `**vet**` en `*cursief*`; invoer wordt eerst HTML-geëscapet en opgeslagen tekst wordt niet aangepast. Het venster gebruikt automatische hoogte met schermbegrenzing en verticale scrolling; tabs en inhoudswijzigingen laten de hoogte opnieuw bepalen.
- 🧪 **Live bevestigd:** Markdown-opmaak in Description en het aanpassen van vensterhoogte bij tabwissels zijn bevestigd. De bestaande Overview-, History- en Edit-tabs blijven beschikbaar. Lange beschrijvingen kunnen bij inhoud boven de schermruimte verticaal scrollen.
- 🛠️ **Gebouwd, live regressietest niet volledig vastgelegd:** Return to Unassigned, Sold en Delete zijn aanwezig. Actor-verwijderacties controleren itemkoppelingen en hoeveelheid; Delete is beperkt tot records zonder huidige holdings en vereist bevestiging. Een eerdere Return-test blokkeerde veilig wegens een ontbrekende of ambigue Actor Item-koppeling. Er is in deze actualisatie geen nieuwe mutatietest uitgevoerd.
- **History-status:** History is alleen bedoeld voor de geschiedenis van het geselecteerde record in Item Detail. Een algemene History-tab op het hoofdniveau valt buiten het huidige ontwerp. Take Loot, Return en Sold kunnen gebeurtenissen aan de recordgeschiedenis toevoegen; de volledige live regressietest hiervan is nog niet vastgelegd.
### Take Loot

- ✅ Take Loot start met één knop vanuit **Item Detail**. De gebruiker kiest een Actor en een hoeveelheid.
- ✅ Bij Shadowdark worden slots getoond. De transfer toont de huidige slots, vrije slots, transferkosten en de resterende vrije slots na de transfer.
- ✅ Een transfer wordt geblokkeerd als de Actor onvoldoende ruimte heeft.
- ✅ Een succesvolle transfer voegt het Foundry Item toe aan de Actor en werkt de Ledger-holdings bij.
- ✅ **Currently with** is uitsluitend informatief en heeft geen aparte Take-knoppen.
- ✅ Eén lootrecord kan meerdere huidige holdings hebben, bijvoorbeeld verdeeld over Actors en één of meer stash-locaties.
- ✅ Nieuwe loot wordt na **Add Loot** niet automatisch aan een Actor toegewezen en wordt niet automatisch als **Stashed** gemarkeerd. De hoeveelheid blijft **Unassigned** totdat de gebruiker bewust een huidige holding kiest.
- ✅ **Found during** en **Location** beschrijven waar loot is gevonden; het zijn historische gegevens en geen huidige holding.
- ✅ **Stashed** ontstaat alleen wanneer de gebruiker expliciet loot op een locatie stasht. Een **Actor holding** ontstaat wanneer loot via **Take Loot** aan een Actor wordt overgedragen.
- ✅ Loot die niet door een Actor wordt gedragen kan als **Stashed** op een fysieke locatie worden bijgehouden.
- ✅ Nadat loot aan een Actor is overgedragen, volgt de Ledger niet automatisch het verdere gebruik of verwijderen van dat item uit de Actor-inventaris. Nieuwe overdrachten die via de Ledger plaatsvinden worden wel geregistreerd.

### Treasury en visueel uitgangspunt

- ✅ Treasury toont alleen de huidige **GP**, **SP** en **CP**. Er komt geen uitgebreide financiële transactiebalans.
- ✅ Er is één gezamenlijke Treasury voor de groep, niet gekoppeld aan een Actor. GM's en spelers mogen de bedragen handmatig aanpassen. Alleen niet-negatieve gehele aantallen zijn toegestaan.
- ✅ Er komen geen automatische geldtransacties of omrekeningen. De **Gem Bag** valt buiten de huidige scope.
- ✅ Voor de groep van ongeveer vier spelers en één DM is eenvoudige **last-write-wins** bij vrijwel gelijktijdige Treasury-wijzigingen aanvaardbaar; een uitgebreid transactiesysteem is niet nodig.
- ✅ Treasury-wijzigingen worden gevalideerd, persistent opgeslagen voor de wereld en tussen GM en spelers gesynchroniseerd. De bestaande veiligheidsmaatregelen voor Take Loot blijven ongewijzigd.
- ✅ Treasury staat rechts naast de Loot-overview, met de bovenrand uitgelijnd op het overzichtspaneel. Het is een compact paneel met een zwarte **TREASURY**-kopbalk en drie verticaal gestapelde invoerrijen: **GP**, **SP** en **CP**. Bedrag links, valuta-afkorting rechts; geen uitgeschreven valutanaam of extra onderdelen. Bij smalle vensters komt het paneel onder het overzicht zodat de tabel leesbaar blijft en horizontaal scrollen wordt vermeden.
- 🛠️ **Gebouwd:** Treasury gebruikt een wereldinstelling met standaardwaarden **0 GP, 0 SP en 0 CP**. Een gewijzigd veld wordt bij `change` opgeslagen; ongewijzigde waarden veroorzaken geen verzoek. Invoer wordt beperkt tot niet-negatieve gehele aantallen. Tijdens opslag worden velden tijdelijk geblokkeerd; bij fouten worden de laatst opgeslagen waarden teruggezet en een fout getoond. Verzoeken lopen via de bestaande socketroute en geserialiseerde GM-wijzigingsroute, met last-write-wins voor opeenvolgende wijzigingen.
- 🧪 **Geïsoleerd getest:** standaardwaarden, geldige en ongeldige invoer, opslag via de GM- en spelersroute, gedeelde wereldinstelling en opeenvolgende updates.
- 🧪 **Live getest:** de GM sloeg **12 GP, 5 SP en 3 CP** op; na herladen bleven deze bedragen behouden. Sander kon GP aanpassen naar **13** en opslaan. Een latere GM-/spelercontrole van Treasury is als geslaagd bevestigd, inclusief uitwisseling tussen beide rollen. De testbedragen zijn na afloop op **0/0/0** gezet. Exacte bedragen van die latere controle zijn niet vastgelegd.
- ✅ De meest recente Loot Ledger-mock-up is voorlopig het visuele uitgangspunt: compact en leesbaar, Shadowdark-geïnspireerd, met een donkere achtergrond, parchment-achtige panelen, sobere ornamentatie en Foundry-itemafbeeldingen.
- ✅ Visuele details mogen tijdens het prototypen worden aangepast wanneer dat de bruikbaarheid verbetert.
### Market Value en Loot-overviewweergave

- ✅ **Market Value** betekent de geschatte waarde per afzonderlijk item, onafhankelijk van de Foundry-stackgrootte. Add Loot stelt waar mogelijk deze waarde voor; de gebruiker kan haar aanpassen.
- ✅ Bestaande opgeslagen waarden worden niet automatisch omgerekend, omdat hun oorspronkelijke betekenis niet altijd betrouwbaar kan worden vastgesteld.
- ✅ De Loot-overview gebruikt de kolommen **Item | Qty | Slots | Whereabouts | Value**. De afzonderlijke **Actions**-kolom en **Details**-knop zijn verwijderd; de volledige rij opent Item Detail. De rij is ook met toetsenbordbediening te activeren. De ondertitel is verwijderd; de gotische titel luidt **Loot Ledger**.
- ✅ Itemnamen mogen maximaal twee regels gebruiken voordat ze worden afgekapt. De tabel gebruikt de beschikbare vensterbreedte zonder een geforceerde minimum breedte of horizontale scrollbar bij de normale vensterbreedte.
- ✅ Qty toont de gevonden hoeveelheid; Slots volgt Shadowdarks bestaande item- en slotregels voor die hoeveelheid.
- ✅ **Whereabouts** toont de huidige holdings, met afzonderlijke aantallen per houder. **Value** toont de geschatte waarde per item. De bestaande sorteerfunctie blijft behouden.

### Bevestigde UI-verbeteringen

- ✅ De Treasury heeft geen Save-knop. Een gewijzigd GP-, SP- of CP-veld wordt bij het verlaten ervan opgeslagen via de bestaande GM-/spelersocketroute. Validatie, herstel bij fout, verzoekcontrole en last-write-wins zijn geïmplementeerd.
- ✅ Het Loot Ledger-venster opent met automatische hoogte, begrensd door de schermruimte. Inhoud kan verticaal scrollen; handmatig vergroten/verkleinen en de responsieve indeling blijven beschikbaar. CSS voorkomt horizontale overflow.
- ✅ De zichtbare titel boven de Loot-overview is **Loot Ledger**. De officiële modulenaam en interne identificaties blijven ongewijzigd.
- ✅ Item Detail toont de afbeelding links en de naam met Description rechts; overige campagnegegevens en holdings staan daaronder. Markdown en automatische vensterhoogte zijn live bevestigd.
### Samenwerking en projectindeling

- ✅ De ideeënchat is bedoeld om vrij te brainstormen; ideeën daar zijn niet automatisch besluiten.
- ✅ De Loot Ledger-projectruimte is de werkplaats voor besluiten, ontwerp, bestanden, code en tests. Een discussie is niet automatisch een besluit.

## Huidige workflow en architectuur

**Toevoegen:** Foundry Item uit Compendium of Items → dropzone **Drag an item here** → **Add Loot**-scherm → item wordt bijgehouden in Loot Ledger.

**Overdragen:** vanuit **Item Detail** kiest de gebruiker een Actor en hoeveelheid. Loot Ledger toont de Shadowdark-slotinformatie en blokkeert de transfer als er onvoldoende ruimte is. Bij succes worden Actor-inventaris en Ledger-holdings bijgewerkt.

De Foundry Actor-inventaris blijft leidend voor wat een personage draagt; het oorspronkelijke Foundry Item blijft leidend voor de itemeigenschappen. De technische module-indeling is nog niet vastgesteld.

## Technische bevindingen: Actor-itemoverdracht en Shadowdark-slots

- ✅ **Besloten:** Take Loot kan een bestaand Foundry Item aan een Shadowdark Actor toevoegen via Foundry’s Actor API.
- ✅ **Besloten:** Voor inventory- en slotregels gebruikt Loot Ledger Shadowdarks eigen logica en dupliceert het die regels niet.
- 🧪 **Getest:** Relevante gegevens zijn onder meer `Item.system.quantity`, `Item.system.slots` en `Item.system.slotsUsed`. De Actorstatus kan worden gelezen via Shadowdarks `Actor.system.getPhysicalItems()` en `Actor.system.getSlotUsage()`.
- 🧪 **Getest:** Stackable Items volgen Shadowdarks bestaande berekening. Arrows x21 gebruikte 2 slots bij een stackgrootte van 20.
- ✅ **Besloten:** Vóór Take Loot controleert Loot Ledger of de Actor voldoende vrije slots heeft. Bij onvoldoende ruimte wordt de overdracht geblokkeerd voordat de Actor-inventaris verandert.
- 🧪 **Getest:** Na een geslaagde overdracht kan worden gecontroleerd dat het Item daadwerkelijk in de Actor-inventaris staat.
- 🧪 **Getest:** Deze bevindingen zijn daadwerkelijk beproefd in Foundry VTT 14 build 368 met Shadowdark 4.0.6.

Deze bevindingen leggen de technische werking vast en wijzigen de functionele scope niet.

## Technische bevindingen: Foundry Item en historische snapshot

- **Bewezen/getest:** Loot Ledger kan Items vanuit zowel Compendiums als World Items via drag-and-drop ontvangen.
- Foundry levert drag-data met een UUID. Compendium-UUID's (Compendium...) en World Item-UUID's (Item...) hebben verschillende vormen, maar worden via dezelfde algemene UUID-resolutieaanpak verwerkt.
- **Bewezen/getest:** De historische snapshot bevat zelfstandig gekopieerde Item-data en is niet afhankelijk van het oorspronkelijke Item-object. De relevante gegevens bleven behouden nadat de tijdelijke Item-kopie was gewijzigd en verwijderd.
- De oorspronkelijke Item-ID/UUID kan daarnaast worden bewaard als technische bronverwijzing voor het later maken of overdragen van een echt Foundry Item.
- **Bewezen/getest:** Take Loot gebruikt Shadowdark's bestaande inventory-, slot- en stacklogica. Voldoende vrije slots worden gecontroleerd voordat de Actor-inventaris wordt gewijzigd; bij onvoldoende ruimte wordt de overdracht geblokkeerd.
- **Getest in:** Foundry VTT 14 build 368 met Shadowdark 4.0.6.

## Niet-doelen

- De module is geen algemene inventaris voor personages.
- De module is geen catalogus of database van alle items.
- De module volgt niet automatisch elke handeling met items.
- De module biedt geen uitgebreide financiële transactiebalans.
- Vooralsnog bouwen we geen eigen uitgebreide itemzoeker.

## Open beslissingen en technische aandachtspunten

- Foundry VTT 14 build 368 en Shadowdark 4.0.6 zijn de huidige testversies; ondersteuning voor andere versies is niet vastgesteld.
- De structurele oplossing voor dubbele Take Loot-verwerking blijft open. Gebruik voor overdrachtstests voorlopig maximaal één actieve GM-client.
- Return to Unassigned en Sold zijn gebouwd, maar hun volledige live regressieteststatus is niet compleet vastgelegd; de bekende ambigue koppeling blijft reden om voorzichtig te testen.
- De actuele wereldtoestand en Actor-inventarissen zijn niet live gecontroleerd tijdens deze documentupdate.
- Licentieonderzoek wees uit dat Shadowdark-fonts en ornamenten niet zonder aangetoonde toestemming moeten worden meegeleverd. Een eigen Shadowdark-geïnspireerde vormgeving is de voorkeursrichting voor verdere visuele aanpassingen. Openbare distributie vereist afzonderlijke duidelijkheid over toepasselijke licenties, in het bijzonder voor een VTT-gerelateerde tool.
---

Werk dit bestand bij wanneer een besluit verandert of wanneer werk daadwerkelijk is gebouwd of getest. Houd besluiten, ideeën en open vragen duidelijk gescheiden.
