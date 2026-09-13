/** H 전용 진행 문구. Y의 격자·버전 표기와 섞지 않아요. */
import { hModeFaces } from './h-profile.js';

export const H_SCANNER_COPY=Object.freeze({
  ko:{title:'H 큐브 수집',idle:'R2 카메라 또는 사진에서 H 큐브를 읽어요.',
    collecting:'{count}/{required}면 수집',checking:'{count}/{required}면 · 본문 재확인 중',done:'{count}/{required}면 · 본문 검증 완료',
    missing:'남은 면: {faces}',camera:'1~3면씩 모아요. 큐브 전체를 화면에 두고 천천히 돌려 주세요.',
    photo:'같은 큐브의 다른 면 사진을 이어 선택하세요. 면은 마지막 관측부터 90초간 보관해요.',cubeGuide:'줌이나 거리를 조절하여 큐브 크기를 중간 녹색 가이드에 맞춰 주세요.',
    reset:'H 수집 초기화',expired:'이전 면이 만료됐어요. 다시 모아 주세요.',summary:'Type H · H{version} (n{n}) · {mode}면 · {tones}톤 · RS/CRC 검증',emptyPhoto:'이번 사진에서는 H 면을 확인하지 못했어요.'},
  en:{title:'H cube collection',idle:'Read an H cube with the R2 camera or photos.',
    collecting:'{count}/{required} faces collected',checking:'{count}/{required} faces · checking payload',done:'{count}/{required} faces · payload verified',
    missing:'Missing faces: {faces}',camera:'Collect 1–3 faces at a time. Keep the whole cube in view and turn it slowly.',
    photo:'Choose more photos of the same cube. Each face is retained for 90 seconds after observation.',cubeGuide:'Adjust zoom or distance so the cube fits the middle green guide.',
    reset:'Reset H collection',expired:'Previous faces expired. Collect them again.',summary:'Type H · H{version} (n{n}) · {mode} faces · {tones} tones · RS/CRC verified',emptyPhoto:'No H face was confirmed in this photo.'},
  ja:{title:'H キューブ収集',idle:'R2 カメラまたは写真で H キューブを読み取ります。',
    collecting:'{count}/{required}面を収集',checking:'{count}/{required}面 · 本文を再確認中',done:'{count}/{required}面 · 本文検証完了',
    missing:'残りの面: {faces}',camera:'1～3面ずつ集めます。キューブ全体を画面に入れ、ゆっくり回してください。',
    photo:'同じキューブの別の面の写真を続けて選んでください。各面は観測から90秒間保持します。',cubeGuide:'ズームや距離を調整して、キューブの大きさを中央の緑色ガイドに合わせてください。',
    reset:'H 収集をリセット',expired:'前の面の保持期限が切れました。もう一度集めてください。',summary:'Type H · H{version} (n{n}) · {mode}面 · {tones}階調 · RS/CRC 検証済み',emptyPhoto:'この写真では H の面を確認できませんでした。'},
  fr:{title:'Collecte du cube H',idle:'Lisez un cube H avec la caméra R2 ou des photos.',
    collecting:'{count}/{required} faces collectées',checking:'{count}/{required} faces · vérification du contenu',done:'{count}/{required} faces · contenu vérifié',
    missing:'Faces manquantes : {faces}',camera:'Collectez 1 à 3 faces à la fois. Gardez le cube entier visible et tournez-le lentement.',
    photo:'Choisissez d’autres photos du même cube. Chaque face est conservée 90 secondes après observation.',cubeGuide:'Ajustez le zoom ou la distance pour que le cube corresponde au guide vert central.',
    reset:'Réinitialiser la collecte H',expired:'Les faces précédentes ont expiré. Collectez-les à nouveau.',summary:'Type H · H{version} (n{n}) · {mode} faces · {tones} tons · RS/CRC vérifié',emptyPhoto:'Aucune face H confirmée dans cette photo.'},
  it:{title:'Raccolta cubo H',idle:'Legga un cubo H con la fotocamera R2 o le foto.',
    collecting:'{count}/{required} facce raccolte',checking:'{count}/{required} facce · verifica del contenuto',done:'{count}/{required} facce · contenuto verificato',
    missing:'Facce mancanti: {faces}',camera:'Raccolga da 1 a 3 facce alla volta. Mantenga visibile tutto il cubo e lo ruoti lentamente.',
    photo:'Scelga altre foto dello stesso cubo. Ogni faccia viene conservata per 90 secondi dopo l’osservazione.',cubeGuide:'Regoli lo zoom o la distanza per adattare il cubo alla guida verde centrale.',
    reset:'Reimposta raccolta H',expired:'Le facce precedenti sono scadute. Le raccolga di nuovo.',summary:'Type H · H{version} (n{n}) · {mode} facce · {tones} toni · RS/CRC verificato',emptyPhoto:'Nessuna faccia H confermata in questa foto.'},
  de:{title:'H-Würfel sammeln',idle:'Lesen Sie einen H-Würfel mit der R2-Kamera oder Fotos.',
    collecting:'{count}/{required} Flächen gesammelt',checking:'{count}/{required} Flächen · Inhalt wird geprüft',done:'{count}/{required} Flächen · Inhalt geprüft',
    missing:'Fehlende Flächen: {faces}',camera:'Sammeln Sie jeweils 1–3 Flächen. Halten Sie den ganzen Würfel im Bild und drehen Sie ihn langsam.',
    photo:'Wählen Sie weitere Fotos desselben Würfels. Jede Fläche bleibt nach der Erfassung 90 Sekunden gespeichert.',cubeGuide:'Passen Sie Zoom oder Abstand so an, dass der Würfel zur mittleren grünen Orientierungshilfe passt.',
    reset:'H-Sammlung zurücksetzen',expired:'Die bisherigen Flächen sind abgelaufen. Erfassen Sie sie erneut.',summary:'Type H · H{version} (n{n}) · {mode} Flächen · {tones} Tonwerte · RS/CRC geprüft',emptyPhoto:'Auf diesem Foto wurde keine H-Fläche bestätigt.'},
  es:{title:'Recopilación del cubo H',idle:'Lea un cubo H con la cámara R2 o con fotos.',
    collecting:'{count}/{required} caras recopiladas',checking:'{count}/{required} caras · comprobando contenido',done:'{count}/{required} caras · contenido verificado',
    missing:'Caras pendientes: {faces}',camera:'Recopile entre 1 y 3 caras cada vez. Mantenga todo el cubo visible y gírelo lentamente.',
    photo:'Seleccione más fotos del mismo cubo. Cada cara se conserva durante 90 segundos desde su observación.',cubeGuide:'Ajuste el zoom o la distancia para que el cubo encaje en la guía verde central.',
    reset:'Reiniciar recopilación H',expired:'Las caras anteriores han caducado. Recopílelas de nuevo.',summary:'Type H · H{version} (n{n}) · {mode} caras · {tones} tonos · RS/CRC verificado',emptyPhoto:'No se ha confirmado ninguna cara H en esta foto.'},
  pt:{title:'Recolha do cubo H',idle:'Leia um cubo H com a câmara R2 ou fotografias.',
    collecting:'{count}/{required} faces recolhidas',checking:'{count}/{required} faces · a verificar o conteúdo',done:'{count}/{required} faces · conteúdo verificado',
    missing:'Faces em falta: {faces}',camera:'Recolha 1 a 3 faces de cada vez. Mantenha o cubo inteiro visível e rode-o lentamente.',
    photo:'Selecione mais fotografias do mesmo cubo. Cada face é guardada durante 90 segundos após a observação.',cubeGuide:'Ajuste o zoom ou a distância para que o cubo se ajuste à guia verde central.',
    reset:'Repor recolha H',expired:'As faces anteriores expiraram. Recolha-as novamente.',summary:'Type H · H{version} (n{n}) · {mode} faces · {tones} tons · RS/CRC verificado',emptyPhoto:'Não foi confirmada nenhuma face H nesta fotografia.'},
});
const H_SCOPE_COPY={
  ko:'R2는 Y와 H 큐브를 여러 프레임에 걸쳐 읽어요. H는 선택한 1~6개의 고유 데이터 면 전체를 모아 본문을 검증해요. 다른 TL 타입은 R1로 전환해 보세요.',
  en:'R2 reads Y and H cubes across frames. H requires all selected unique data faces (1–6) and payload verification. For other TL types, try R1.',
  ja:'R2 は Y と H キューブを複数フレームで読み取ります。H は選択した全データ面（1～6面）と本文検証が必要です。他の TL タイプは R1 をお試しください。',
  fr:'R2 lit les cubes Y et H sur plusieurs images. H exige toutes les faces de données sélectionnées (1 à 6) et la validation du contenu. Pour les autres types TL, essayez R1.',
  it:'R2 legge i cubi Y e H su più fotogrammi. H richiede tutte le facce dati selezionate (da 1 a 6) e la verifica del contenuto. Per gli altri tipi TL, provi R1.',
  de:'R2 liest Y- und H-Würfel über mehrere Bilder. H benötigt alle gewählten Datenflächen (1 bis 6) und eine Inhaltsprüfung. Für andere TL-Typen nutzen Sie R1.',
  es:'R2 lee cubos Y y H en varios fotogramas. H requiere todas las caras de datos seleccionadas (de 1 a 6) y verificar el contenido. Para otros tipos TL, pruebe R1.',
  pt:'R2 lê cubos Y e H em vários fotogramas. H requer todas as faces de dados selecionadas (1 a 6) e a verificação do conteúdo. Para outros tipos TL, experimente R1.',
};
export function hScannerText(lang,key,values={}){
  if(key==='scope')return H_SCOPE_COPY[lang]??H_SCOPE_COPY.en;
  const template=(H_SCANNER_COPY[lang]??H_SCANNER_COPY.en)[key]??H_SCANNER_COPY.en[key]??'';
  return template.replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??''));
}

export function hCameraActive(snapshot,now){
  const at=snapshot?.lastConfirmedAt;
  return Number.isFinite(at)&&now>=at&&now-at<=500;
}
export function hProgressModel(snapshot,lang='en',{source='camera',now=0}={}){
  const row=snapshot?.assemblies?.find(item=>item.id===snapshot.leadingId);
  const expired=Boolean(row&&Number.isFinite(row.expiresAt)&&now>row.expiresAt);
  const required=!expired&&[1,2,3,4,5,6].includes(snapshot?.required)?snapshot.required:0;
  const ids=required?hModeFaces(required):[];
  const present=required?ids.filter(face=>(row?.present??snapshot.present??[]).includes(face)
    &&(!Number.isFinite(row?.faceExpiresAt?.[face])||now<=row.faceExpiresAt[face])):[];
  const missing=ids.filter(face=>!present.includes(face));
  const count=present.length,state=count===0?'EMPTY':snapshot.state==='DONE'?'DONE':'COLLECTING';
  const key=state==='DONE'?'done':count===required&&required?'checking':'collecting';
  const current=source==='camera'&&Number.isFinite(snapshot?.observedAt)&&now-snapshot.observedAt<=500;
  const deadlines=[row?.expiresAt,...Object.values(row?.faceExpiresAt??{})].filter(at=>Number.isFinite(at)&&at>=now);
  const nextExpiryAt=deadlines.length?Math.min(...deadlines)+1:null;
  return {state,required,count,present,missing,nextExpiryAt,canReset:count>0,title:hScannerText(lang,'title'),
    summary:expired?hScannerText(lang,'expired'):required?hScannerText(lang,key,{count,required}):hScannerText(lang,'idle'),
    detail:missing.length?hScannerText(lang,'missing',{faces:missing.join(' · ')}):'',
    hint:hScannerText(lang,source==='photos'?'photo':'camera'),resetLabel:hScannerText(lang,'reset'),
    faces:ids.map(face=>({face,present:present.includes(face),
      current:current&&snapshot.observedFaces?.some(item=>item.face===face)===true}))};
}
