window.data=Array.isArray(window.data)?window.data:[];
(function(){
  var row=["35","marche","Marché du mardi matin","Mordelles","mardi","8h30-12h30","Marché hebdomadaire municipal vérifié sur le site officiel de la Ville de Mordelles : produits alimentaires et non alimentaires, place et halle des Muletiers.","Environ 30 places","Place et halle des Muletiers, 35310 Mordelles",["https://www.ville-mordelles.fr/marches-hebdomadaires/"],48.0722413,-1.8518779,"Non publié officiellement","Contacter l’accueil de la mairie de Mordelles pour demander un emplacement"];
  var exists=window.data.some(function(r){return Array.isArray(r)&&String(r[0])==='35'&&String(r[3]).toLowerCase()==='mordelles'&&String(r[4]).toLowerCase()==='mardi'});
  if(!exists)window.data.push(row);
})();
document.write('<script src="markets-17-complete-v144.js?v=20260912-dept17-complet2"><\/script>');
