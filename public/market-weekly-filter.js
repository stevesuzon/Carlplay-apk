(function(){
  'use strict';
  var days=['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  /* Producteurs/vente directe ne sont pas classés comme marché municipal hebdomadaire.
     Les autres marchés réguliers (bio, fleurs, livres, etc.) restent visibles. */
  var excluded=/\b(producteur|producteurs|producent|producenten|paysan|paysans|boerenmarkt|vente directe)\b/;
  function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,"'").replace(/\s+/g,' ').trim()}
  function blob(r){return norm([r[1],r[2],r[4],r[5],r[6],r[8]].join(' '))}
  function periodic(r){var s=blob(r);return /(toutes? les 2 semaines|toutes? les deux semaines|une semaine sur deux|semaines? (?:paires?|impaires?)|bimensuel|bi-?mensuel|mensuel|trimestriel)/.test(s)}
  function seasonal(r){var s=blob(r);return /(?:saisonnier|saisonniere|marche d'?ete|zomermarkt|uniquement en (?:ete|hiver|printemps|automne)|pendant (?:l'?ete|l'?hiver|le printemps|l'?automne))/.test(s)}
  function dayList(v){var s=norm(v),out=[];for(var i=0;i<days.length;i++){if(new RegExp('(?:^|[^a-z])'+days[i]+'(?:$|[^a-z])').test(s))out.push(days[i])}return out}
  function expandDays(target){
    if(!Array.isArray(target))return;
    var out=[];
    for(var i=0;i<target.length;i++){
      var r=target[i];
      if(!Array.isArray(r))continue;
      var ds=dayList(r[4]);
      if(ds.length===0){out.push(r);continue}
      for(var j=0;j<ds.length;j++){var c=r.slice();c[4]=ds[j];out.push(c)}
    }
    target.splice(0,target.length);
    Array.prototype.push.apply(target,out);
  }
  function keep(r){
    if(!Array.isArray(r)||String(r[1])!=='marche')return false;
    if(days.indexOf(norm(r[4]))<0)return false;
    if(excluded.test(blob(r)))return false;
    /* Ne jamais déduire qu'un marché est ponctuel uniquement depuis une date
       publiée par la source. On retire seulement les périodiques/saisonniers
       explicitement indiqués. */
    if(periodic(r)||seasonal(r))return false;
    return true;
  }
  function clean(target){if(!Array.isArray(target))return;expandDays(target);for(var i=target.length-1;i>=0;i--)if(!keep(target[i]))target.splice(i,1)}
  clean(window.data);clean(window.NEAR_FR);clean(window.NEAR_BE);
})();
