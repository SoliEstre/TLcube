# TLcube i18n 용어집 (8언어 정본)

> 작성 2026-08-17 · 레인 i18n (fr·it·de·es·pt 확장)
> **저작 원본 = ko** (`DEFAULT_LANGUAGE='ko'`), en 은 참조 병행.
> 이 표가 정본이다. 같은 용어는 같은 역어를 쓴다. 표에 없는 용어가 나오면 **표에 먼저 추가하고** 번역한다.

## 0. 번역하지 않는 것 (그대로 둔다)

| 부류 | 예 |
|---|---|
| 레이아웃/후보 id | `v0` · `v0X` · `v0XQ` · `v0W` · `v0WQ` · `v1r2` · `v2r2` · `K3` |
| 버전 라벨 | `V1`·`V2`·`V3` · `Y0`·`Y1`·`Y2` · `A0`·`A1`·`A2` |
| 진법 표기 | `base-6` — 각 언어 관행 표기 허용 (fr/it/es/pt `base 6` · de `Basis 6`), 값 자체는 불변 (검증 렌즈 2026-08-17 E-1 등재) |
| 타입 부호 | `Type O` · `Type A` · `Type Y` · `Type K` (관사·어순만 각 언어에 맞춤: `Tipo Y`, `Typ Y`) |
| 면 부호 | `T` · `L` · `R` (밝은 면·왼쪽 면·오른쪽 면) |
| 고유명 | `TL` · `TLcube` · `TrilLuminance` · `Trilume` · `SoliEstre` · `Slate` · `Ember` · `Mono` |
| 수치·단위·기호 | `B` · `cm` · `m` · `n=21` · `k=13` · `Δmin` · `β` · `≈40%` · `20/20 → 6/20` · `8×8` |
| 규격 참조 | `SPEC §4.4` · `§14` · `ECC H/M/L` · `QR` · `PNG` · `SVG` · `JSON` |
| 필드명 | `reference/format` (셀 편집기 역할 라벨 — 와이어 필드명이라 그대로) |
| 소스 파일명 | `cellSurfaceFinal.js` (lab 전용 g906 에만 등장. 정식 화면 도움말에는 금지) |

## 1. 핵심 용어 대응표

### 1.1 구조·기하

| ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|
| 셀 | cell | セル | cellule | cella | Zelle | celda | célula |
| 모듈 | module | モジュール | module | modulo | Modul | módulo | módulo |
| 면 | face | 面 | face | faccia | Fläche | cara | face |
| 큐브 | cube | キューブ | cube | cubo | Würfel | cubo | cubo |
| 육각 | hex | 六角 | hexagone | esagono | Sechseck | hexágono | hexágono |
| 마름모 | rhombus | ひし形 | losange | rombo | Raute | rombo | losango |
| 삼각 | triangle | 三角 | triangle | triangolo | Dreieck | triángulo | triângulo |
| 격자 | grid | 格子 | grille | griglia | Gitter | rejilla | grelha |
| 실루엣 | silhouette | シルエット | silhouette | silhouette | Silhouette | silueta | silhueta |
| 셀 표면 | cell surface | セル表面 | surface de cellules | superficie a celle | Zellfläche | superficie de celdas | superfície de células |

### 1.2 검출 기구

| ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|
| 검출기 | detector | 検出器 | détecteur | rilevatore | Detektor | detector | detector |
| 파인더 | finder | ファインダ | motif de repérage (짧게 repère) | pattern di ricerca (짧게 pattern) | Suchmuster | patrón localizador (짧게 patrón) | padrão localizador (짧게 padrão) |
| 로케이터 | locator | ロケータ | localisateur | localizzatore | Lokator | localizador | localizador |
| 불스아이 | bullseye | ブルズアイ | cible | bersaglio | Zielscheibe | diana | alvo |
| 앵커 | anchor | アンカー | ancre | ancora | Anker | ancla | âncora |
| 위상 마커 | phase marker | 位相マーカー | marqueur de phase | marcatore di fase | Phasenmarker | marcador de fase | marcador de fase |
| 동심 사각 | concentric square | 同心四角 | carré concentrique | quadrato concentrico | konzentrisches Quadrat | cuadrado concéntrico | quadrado concêntrico |
| 슬롯 (중앙 QR) | slot | スロット | emplacement | slot | Slot | ranura | ranhura |
| 중앙 QR | centre QR | 中央 QR | QR central | QR centrale | zentraler QR | QR central | QR central |
| 코너 QR | corner QR | コーナー QR | QR d'angle | QR d'angolo | Eck-QR | QR de esquina | QR de canto |
| 폴백 QR | fallback QR | フォールバック QR | QR de secours | QR di riserva | Ersatz-QR | QR de respaldo | QR de reserva |
| 마스크 | mask | マスク | masque | maschera | Maske | máscara | máscara |

**주** — `파인더`·`로케이터`는 이 UI 에서 사실상 같은 물건을 가리키지만 (O/A 섹션은 «파인더», Y 섹션은 «로케이터»), **역어를 합치지 않는다**. 합치면 두 섹션 문구가 같아져 «어느 섹션 얘기인가» 를 화면이 대답 못 한다.

### 1.3 렌더·색

| ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|
| 톤 | tone | トーン | ton | tono | Tonwert | tono | tom |
| 휘도 | luminance | 輝度 | luminance | luminanza | Luminanz | luminancia | luminância |
| 상대휘도 | relative luminance | 相対輝度 | luminance relative | luminanza relativa | relative Luminanz | luminancia relativa | luminância relativa |
| 분리 | separation | 分離 | séparation | separazione | Trennung | separación | separação |
| 면 게인 | face gain | 面ゲイン | gain de face | guadagno delle facce | Flächenverstärkung | ganancia de caras | ganho das faces |
| 렌더 프로파일 | render profile | レンダープロファイル | profil de rendu | profilo di rendering | Renderprofil | perfil de renderizado | perfil de renderização |
| 화면용 | screen | 画面用 | Écran | Schermo | Bildschirm | Pantalla | Ecrã |
| 출력물용 | print | 印刷用 | Impression | Stampa | Druck | Impresión | Impressão |
| 입체 음영 | 3D shading | 立体陰影 | ombrage 3D | ombreggiatura 3D | 3D-Schattierung | sombreado 3D | sombreamento 3D |
| 그림자 | shadow | 影 | ombre | ombra | Schatten | sombra | sombra |
| 반사광 | reflected light | 反射光 | reflet | riflesso | Reflexlicht | reflejo | reflexo |
| 아웃라인 | outline | アウトライン | contour | contorno | Kontur | contorno | contorno |
| 스타일 프리셋 | style preset | スタイルプリセット | préréglage de style | preset di stile | Stilvorgabe | ajuste de estilo | predefinição de estilo |
| 커스텀 (Hue) | custom (hue) | カスタム (Hue) | personnalisé (teinte) | personalizzato (tinta) | benutzerdefiniert (Farbton) | personalizado (matiz) | personalizado (matiz) |
| 배경색 | background colour | 背景色 | couleur d'arrière-plan | colore di sfondo | Hintergrundfarbe | color de fondo | cor de fundo |
| 지면 (인쇄면) | stock | 地 | support | supporto | Bedruckstoff | soporte | suporte |
| 장식 이미지 | decorative image | 装飾画像 | image décorative | immagine decorativa | Dekorbild | imagen decorativa | imagem decorativa |

### 1.4 배치·여백

| ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|
| 안전영역 | safe area / quiet zone | 安全領域 | zone de sécurité | area di sicurezza | Sicherheitsbereich | área de seguridad | área de segurança |
| 콰이어트 존 (QR) | quiet zone | クワイエットゾーン | zone de silence | zona di quiete | Ruhezone | zona de silencio | zona de silêncio |
| 배치 미리보기 | placement preview | 配置プレビュー | aperçu de placement | anteprima di posizionamento | Platzierungsvorschau | vista previa de colocación | pré-visualização de posicionamento |
| 미리보기 | preview | プレビュー | aperçu | anteprima | Vorschau | vista previa | pré-visualização |
| 표면 | surface | 表面 | surface | superficie | Fläche | superficie | superfície |
| 고대비 | high contrast | 高コントラスト | contraste élevé | contrasto elevato | hoher Kontrast | contraste alto | contraste elevado |
| 좌상 / 우상 / 좌하 / 우하 | top-left … | 左上 … | en haut à gauche … | in alto a sinistra … | oben links … | arriba a la izquierda … | canto superior esquerdo … |
| 안쪽 | inside / inner | 内側 | Intérieur | Interno | Innen | Interior | Interior |

### 1.5 용량·부호화

| ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|
| 용량 | capacity | 容量 | capacité | capacità | Kapazität | capacidad | capacidade |
| 페이로드 | payload | ペイロード | charge utile | payload | Nutzdaten | carga útil | carga útil |
| 심볼 | symbol | シンボル | symbole | simbolo | Symbol | símbolo | símbolo |
| 데이터 | data | データ | données | dati | Daten | datos | dados |
| 오류정정 (ECC) | error correction (ECC) | 誤り訂正 (ECC) | correction d'erreurs (ECC) | correzione d'errore (ECC) | Fehlerkorrektur (ECC) | corrección de errores (ECC) | correção de erros (ECC) |
| 보정 우선 | correction first | 訂正優先 | Correction d'abord | Prima la correzione | Korrektur zuerst | Corrección primero | Correção primeiro |
| 대용량 | high capacity | 大容量 | Grande capacité | Grande capacità | Große Kapazität | Gran capacidad | Grande capacidade |
| 해상도 단 | resolution tier | 解像度段 | échelon de résolution | gradino di risoluzione | Auflösungsstufe | escalón de resolución | degrau de resolução |
| 저 / 중 / 고 | low / mid / high | 低 / 中 / 高 | Basse / Moyenne / Haute | Bassa / Media / Alta | Niedrig / Mittel / Hoch | Baja / Media / Alta | Baixa / Média / Alta |
| 소거 | erasure | 消去 | effacement | cancellazione | Auslöschung | borrado | apagamento |
| 잘림 (용량 초과) | truncated | 切り捨て | tronqué | troncato | abgeschnitten | truncado | truncado |

### 1.6 판정·검증

| ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|
| 자체검증 | self-check | 自己検証 | auto-vérification | autoverifica | Selbstprüfung | autocomprobación | autoverificação |
| 게이트 여유 | gate headroom | ゲート余裕 | marge de seuil | margine di soglia | Schwellenspielraum | margen de umbral | margem de limiar |
| 게이트 통과 / 탈락 | gate passed / failed | ゲート通過 / 脱落 | Seuil franchi / non franchi | Soglia superata / non superata | Schwelle bestanden / verfehlt | Umbral superado / no superado | Limiar cumprido / não cumprido |
| 사용가능 / 인식곤란 / 사용불가 | usable / hard to read / not usable | 使用可 / 認識困難 / 使用不可 | utilisable / lecture difficile / inutilisable | utilizzabile / lettura difficile / non utilizzabile | nutzbar / schwer lesbar / unbrauchbar | utilizable / lectura difícil / no utilizable | utilizável / leitura difícil / não utilizável |
| 모형 점수 | model score | モデルスコア | score du modèle | punteggio di modello | Modellwert | puntuación de modelo | pontuação de modelo |
| 기준선 | baseline | 基準線 | référence | riferimento | Referenz | referencia | referência |
| 복호율 | decode rate | 復号率 | taux de décodage | tasso di decodifica | Dekodierrate | tasa de decodificación | taxa de descodificação |
| 인식률 | read rate | 認識率 | taux de lecture | tasso di lettura | Leserate | tasa de lectura | taxa de leitura |
| 계약 | contract | 契約 | contrat | contratto | Vertrag | contrato | contrato |
| 실측 | measurement | 実測 | mesure | misura | Messung | medición | medição |
| 미검증 | unverified | 未検証 | non vérifié | non verificato | ungeprüft | sin verificar | não verificado |
| 실험 / 시험판 | experimental / trial | 実験 / 試験版 | expérimental / essai | sperimentale / prova | Versuch / Test | experimental / prueba | experimental / ensaio |

### 1.7 파인더 점수 축 (g482\~g488 · g506)

| ko | en | fr | it | de | es | pt |
|---|---|---|---|---|---|---|
| 방향 정보 (회전 유일성) | orientation (rotation uniqueness) | Orientation (unicité de rotation) | Orientamento (unicità di rotazione) | Ausrichtung (Eindeutigkeit bei Drehung) | Orientación (unicidad de rotación) | Orientação (unicidade de rotação) |
| 저해상도 생존 | low-resolution survival | Survie en basse résolution | Tenuta a bassa risoluzione | Bestand bei niedriger Auflösung | Supervivencia a baja resolución | Resistência em baixa resolução |
| 국소화 | localization | Localisation | Localizzazione | Lokalisierung | Localización | Localização |
| 데이터 구별도 | data distinction | Distinction des données | Distinzione dei dati | Unterscheidbarkeit der Daten | Distinción de datos | Distinção dos dados |
| 구조 단순성 | structural simplicity | Simplicité structurelle | Semplicità strutturale | Struktureinfachheit | Sencillez estructural | Simplicidade estrutural |
| 결손 집중도 | defect concentration | Concentration des défauts | Concentrazione dei difetti | Fehlerkonzentration | Concentración de defectos | Concentração de defeitos |
| 중심 오프셋 | centre offset | Décalage du centre | Scostamento del centro | Mittenversatz | Desplazamiento del centro | Desvio do centro |
| 촬영 강건성 | capture robustness | Robustesse à la prise de vue | Robustezza in ripresa | Aufnahmerobustheit | Robustez de captura | Robustez de captura |

### 1.8 셀 편집기

| ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|
| 셀 편집기 | cell editor | セル編集 | Éditeur de cellules | Editor delle celle | Zelleneditor | Editor de celdas | Editor de células |
| 톤 편집 | tone edit | トーン編集 | Édition des tons | Modifica dei toni | Tonwerte bearbeiten | Edición de tonos | Edição de tons |
| 데이터 영역 마스크 | data-area mask | データ領域マスク | Masque de la zone de données | Maschera dell'area dati | Maske des Datenbereichs | Máscara del área de datos | Máscara da área de dados |
| 검출기/안전 | detector / keep-out | 検出器/安全 | Détecteur / exclusion | Rilevatore / esclusione | Detektor / Sperrfläche | Detector / exclusión | Detector / exclusão |
| 되돌리기 / 다시하기 | undo / redo | 元に戻す / やり直す | Annuler / Rétablir | Annulla / Ripristina | Rückgängig / Wiederholen | Deshacer / Rehacer | Desfazer / Refazer |
| 단축키 | shortcuts | ショートカット | Raccourcis | Scorciatoie | Tastenkürzel | Atajos | Atalhos |
| 초기화 | reset | 初期化 | Réinitialiser | Reimposta | Zurücksetzen | Restablecer | Repor |
| 설정값 복사 | copy settings | 設定値コピー | Copier les réglages | Copia le impostazioni | Einstellungen kopieren | Copiar los ajustes | Copiar as definições |
| 어두움 / 중간 / 밝음 | dark / mid / bright | 暗 / 中 / 明 | sombre / moyen / clair | scuro / medio / chiaro | dunkel / mittel / hell | oscuro / medio / claro | escuro / médio / claro |

### 1.9 조작 안내 (핀치 어휘 — 테스트가 고정)

| ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|
| 드래그로 이동 | drag to move | ドラッグで移動 | faire glisser pour déplacer | trascinare per spostare | Ziehen zum Verschieben | arrastrar para mover | arrastar para mover |
| 핀치 | pinch | ピンチ | **pincement** | **pizzico** | **Pinch** | **pellizco** | **pinça** |
| 휠 | scroll / wheel | ホイール | molette | rotella | Mausrad | rueda | roda |
| 확대 / 축소 | zoom in / out | 拡大 / 縮小 | Zoomer / Dézoomer | Ingrandisci / Riduci | Vergrößern / Verkleinern | Acercar / Alejar | Ampliar / Reduzir |

굵게 표시한 «핀치» 낱말은 `test/generator-preview-ui.test.js` 의 `pinch` 표에 그대로 박혀 있다 — 이 역어를 바꾸면 그 테스트도 같은 커밋에서 바꿔야 한다 (g207·g300·g903·g962 네 키가 핀치를 말하는지 재는 핀).

### 1.10 테스트가 파싱하는 단위 낱말

`test/generator-help-capacity.test.js` 는 g906·g541·g546·g548·g603·g605 의 **숫자 옆 낱말**을 정규식으로 잡는다. 아래 낱말을 바꾸면 그 상수(`CELL_WORDS`·`FINDER_WORDS`·`SLOT_WORDS`·`DATA_WORDS`)도 같이 바꿔야 한다.

| 역할 | ko | en | ja | fr | it | de | es | pt |
|---|---|---|---|---|---|---|---|---|
| 셀 (수 뒤) | 셀 | cells | セル | cellules | celle | Zellen | celdas | células |
| 파인더 앵커 | 파인더 | finder | ファインダ | motif | pattern | Suchmuster | patrón | padrão |
| 슬롯 앵커 | 슬롯 | slot | スロット | emplacement | slot | Slot | ranura | ranhura |
| 데이터 앵커 | 데이터 | data | データ | données | dati | Daten | datos | dados |

## 2. 존대·문체 규약

| 언어 | 규약 | 적용 |
|---|---|---|
| ko | «\~에요/어요» 체 (저작 원본) | 기존 문구 무변경 |
| en | 평서 UI 체 | 기존 문구 무변경 |
| ja | «です·ます» 체 | 기존 문구 무변경 |
| fr | **vouvoiement** — 동사를 쓸 땐 `vous`(«Choisissez…», «Déposez…») | 라벨은 명사구로 짧게 |
| it | 표준 UI 체 — 비인칭 `È possibile` / 명령형은 **tu (2인칭 단수) 로 고정** (이탈리아어 UI 관행 — voi·Lei 를 쓰지 않는다. 검증 렌즈 2026-08-17: 42키 전수 tu 일관 실측) | 라벨은 명사구 |
| de | **Siezen** — `Sie`(«Wählen Sie…», «Legen Sie…»), 라벨은 독일어 UI 관행대로 명사형 | 명사 대문자 준수 |
| es | **usted** — 3인칭 단수 명령/직설(«Elija…», «Coloque…») | 라벨은 명사구 |
| pt | 표준 UI 체 — 비인칭 `É possível` / usted 계열 3인칭(«Escolha…», «Coloque…»), pt-PT/pt-BR 중립 어휘 우선 | 라벨은 명사구 |

라벨(카드·버튼·섹션명)은 **짧게 명사구**, 툴팁·도움말 본문은 **완문**으로 쓴다.

## 3. 금지 사항 (사전 값)

1. **리터럴 `**` 금지** — 도움말 팝오버는 `textContent` 로 렌더한다. 별표가 화면에 그대로 보인다 (`generator-help-ui.test.js` 가 잰다).
2. **치환 토큰 보존** — `{sep}` `{min}` `{cells}` `{picked}` `{mean}` `{tight}` `{pct}` `{msg}` `{message}` `{name}` `{filename}` `{state}` `{total}` `{delta}` `{margin}` `{n}` `{e}` `{d}` `{type}` `{ver}` `{k}` `{ecc}` `{tones}` `{bytes}` `{max}` `{bits}` `{tier}` `{hue}` `{color}` `{warn}` `{ratio}` `{rate}` `{rotation}` `{score}` `{baseline}` `{face}` `{i}` `{j}` `{q}` `{r}` `{tone}` `{role}` — ko 와 **같은 집합**이어야 한다.
   - `{tight}%` 는 `%` 를 **붙여서** 쓴다 (`generator-help-ui.test.js` 정규식). 프랑스어 조판 관행(숫자와 `%` 사이 공백)을 여기서는 적용하지 않는다.
3. **`<b>`·`<span>` 태그 구조 보존** — `data-i18n-html` 로 들어가는 값(g300 등)은 태그 열림·닫힘 순서가 ko 와 같아야 한다.
4. **줄 수 보존** — 여러 줄 도움말(g900·g901·g902·g903·g904·g905·g906·g907·g971·g982)은 `\n` 개수를 ko 와 맞춘다. 팝오버가 줄 단위로 쪼갠다(`linesFor: t(...).split('\n')`).
   - 예외 g070: en 이 이미 한 줄로 합쳐 놓았고 새 5언어도 en 을 따른다.
5. **앞뒤 공백 보존** — g417·g435·g436·g450·g991 은 뒤 공백, g428·g434·g454·g991·g992 는 앞 공백이 **연결용**이다. 지우면 문장이 붙는다.
6. **정식 화면 도움말에 내부 명칭 금지** — `v0X`·`v0x`·`v1r2`·`v2r2`·`cellSurfaceFinal`·`cell-surface-`·`hex-frame`·`locatorProfileY`·`*.js`. lab 전용 키(g906 등)만 예외.
7. **g907 에 «Auto =» 금지** — O/A 파인더 섹션에는 «자동» 카드가 없다. 없는 카드를 설명하면 거짓말이다.
8. **g459 == g515** — 두 검출기 섹션 이름은 언어마다 같아야 한다.

## 4. 과업 2 증보 (스캐너·허브 · 2026-08-17)

과업 2 에서 스캐너(111키)·허브(81키)를 옮기며 새로 못 박은 것들이다.

### 4.1 pt = **pt-PT** 로 통일

과업 1 의 생성기 사전이 이미 pt-PT 어휘로 나갔다 (`Ecrã`·`Repor`·`descodificação`·`definições`). 두 표면이 갈리면 같은 사용자가 화면마다 다른 낱말을 본다. 그래서 스캐너·허브도 pt-PT 로 맞췄다. 허브의 `og:locale` 도 `pt_PT` 다.

| 개념 | pt-PT (채택) | pt-BR (기각) |
|---|---|---|
| 카메라 | câmara | câmera |
| 화면 | ecrã | tela |
| 비밀번호 | palavra-passe | senha |
| 탭 (브라우저) | separador | aba |
| 설정 | definições | configurações |
| 파일 | ficheiro | arquivo |
| 복호 | descodificação | decodificação |

### 4.2 «스캐너» 역어

| ko | en | fr | it | de | es | pt |
|---|---|---|---|---|---|---|
| 스캐너 | scanner | Scanner | Scanner | Scanner | Escáner | Scanner |
| 생성기 | generator | Générateur | Generatore | Generator | Generador | Gerador |

pt 는 «Leitor» 도 자연스럽지만 제품명(`TLcube 스캐너`)의 인지 일관성을 위해 `Scanner` 로 두고, **동사**만 «ler / leitura» 를 쓴다 (`Ler a partir de uma foto`).

### 4.3 `copy.*Suffix` 는 **성 중립**으로 (스캐너 전용 규약)

세 접미사는 `label + suffix` 로 이어 붙는데 앞 라벨의 성이 갈린다 (fr `Adresse` 여성 / `Contenu` 남성). 분사를 일치시키면 절반이 틀린 문장이 된다. 그래서 명사구로 끊는다.

| 키 | fr | it | de | es | pt |
|---|---|---|---|---|---|
| `copy.suffix` (aria) | ` à copier` | ` da copiare` | ` kopieren` | ` para copiar` | ` para copiar` |
| `copy.doneSuffix` | ` — copie effectuée.` | ` — copia eseguita.` | ` wurde kopiert.` | ` — copia realizada.` | ` — cópia efetuada.` |

de 는 분사 일치가 없어 자연스러운 문장형(`Adresse wurde kopiert.`)을 그대로 쓴다.

### 4.4 언어명은 **자기 표기**(endonym)

드롭다운 항목·허브 언어 링크는 전부 자기 표기다 — 언어를 바꾸려는 사람은 «지금 화면 언어를 못 읽는 사람» 이라, 현재 언어로 번역한 언어명(한국어 화면의 「프랑스어」)은 정작 그 사람이 못 읽는다.

`한국어` · `English` · `日本語` · `Français` · `Italiano` · `Deutsch` · `Español` · `Português`

정본은 `src/i18n.js` 의 `LANGUAGE_LABELS` 이고, 허브 `languages[].label` 이 같은 값인지 `test/i18n-language-switch.test.js` 가 잰다.

### 4.5 수치 표기는 번역하지 않는다 (소수점 포함)

허브 복호 시간은 fr/it/de/es/pt 에서 `≈ 0.1 s` 다. 유럽 조판 관행은 소수 쉼표(`0,1`)지만, 같은 수치가 생성기 사전(`0.62`·`20/20 → 6/20`·`≈40%`)과 다르게 보이면 «다른 값» 으로 읽힌다. §0 의 «수치·단위는 그대로» 를 소수점까지 확장 적용한다.
