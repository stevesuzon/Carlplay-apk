(function(){
  'use strict';
  var days=['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  var excluded=/producteur|producent|paysan|fermier|boerenmarkt|marche bio|biologique|ferme|hoeve|vente directe|artisanal|ambacht|metiers d art|marche (?:des |aux )?arts?|fleurs|bloemenmarkt|createur|makers market|salon|brocante|puces|antiquit|livres?|noel|kerst/;
  function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,"'").replace(/\s+/g,' ').trim()}
  function blob(r){return norm([r[1],r[2],r[4],r[5],r[6],r[8]].join(' '))}
  function singleDate(note){var m=String(note||'').match(/Période publiée : (\d{4}-\d{2}-\d{2})<->(\d{4}-\d{2}-\d{2})/);return !!(m&&m[1]===m[2])}
  function periodic(r){var s=blob(r);if(/(?:pornic|la birochere|sainte-marie-sur-mer|le clion-sur-mer|la baule-les-pins|guezy)/.test(s))return false;return /(toutes? les 2 semaines|toutes? les deux semaines|une semaine sur deux|semaines? (?:paires?|impaires?)|bimensuel|bi-?mensuel|mensuel|trimestriel|1er|1ere|premier|premiere|2e|2eme|deuxieme|3e|3eme|troisieme|4e|4eme|quatrieme)[^.;]{0,40}(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/.test(s)||/(?:1er|2e|3e|4e)\s*(?:et|&)\s*(?:1er|2e|3e|4e)/.test(s)}
  function seasonal(r){var s=blob(r);var named=/(saisonnier|saisonniere|saison |marche d'?ete|zomermarkt|uniquement en (?:ete|hiver|printemps|automne)|pendant (?:l'?ete|l'?hiver|le printemps|l'?automne)|du \d{1,2}\s*(?:mai|juin|juillet|aout|septembre) au \d{1,2}\s*(?:mai|juin|juillet|aout|septembre)|de (?:mai|juin|juillet|aout|septembre) a (?:mai|juin|juillet|aout|septembre))/.test(s);if(named)return true;var m=String(r[6]||'').match(/Période publiée : (\d{4}-\d{2}-\d{2})<->(\d{4}-\d{2}-\d{2})/);if(!m)return false;if(!/(marche|markt)/.test(norm([r[1],r[2]].join(' '))))return false;var a=Date.parse(m[1]+'T00:00:00Z'),b=Date.parse(m[2]+'T00:00:00Z');return Number.isFinite(a)&&Number.isFinite(b)&&b>a&&((b-a)/86400000)<300}
  function keep(r){
    if(!Array.isArray(r)||String(r[1])!=='marche')return false;
    if(days.indexOf(norm(r[4]))<0)return false;
    if(excluded.test(blob(r)))return false;
    if(singleDate(r[6])||periodic(r)||seasonal(r))return false;
    return true;
  }
  function clean(target){if(!Array.isArray(target))return;for(var i=target.length-1;i>=0;i--)if(!keep(target[i]))target.splice(i,1)}
  clean(window.data);clean(window.NEAR_FR);clean(window.NEAR_BE);
})();
