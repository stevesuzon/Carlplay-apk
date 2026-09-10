(function(){
'use strict';
var rows=[];
function add(dept,name,city,schedule,address,source,draw,registration){Object.keys(schedule).forEach(function(day){rows.push([dept,'marche',name,city,day,schedule[day],'Marché municipal hebdomadaire — horaires et adresse publiés par la commune.','Non publié officiellement',address,[source],null,null,draw||'Non publié officiellement',registration||'Contacter la mairie ou le placier'])})}

add('02','Marché du Centre-Ville','Saint-Quentin',{mercredi:'7h30-12h30',samedi:'8h-12h30'},'Places Gaspard-de-Coligny, Gracchus-Babeuf et de l’Hôtel-de-Ville, 02100 Saint-Quentin','https://www.saint-quentin.fr/85-marches.htm','Non publié officiellement','Demande d’emplacement auprès du service municipal');
add('02','Marché du Quartier Neuville','Saint-Quentin',{jeudi:'8h-12h30'},'Parking du centre commercial, avenue Pierre-Choquart, 02100 Saint-Quentin','https://www.saint-quentin.fr/TPL_CODE/TPL_ANNUAIRE/PAR_TPL_IDENTIFIANT/81/1344-annuaire.htm');
add('02','Marché du Quartier Europe','Saint-Quentin',{vendredi:'8h-12h30'},'Parking du centre commercial, avenue Robert-Schuman, 02100 Saint-Quentin','https://www.saint-quentin.fr/TPL_CODE/TPL_ANNUAIRE/PAR_TPL_IDENTIFIANT/71/1344-annuaire.htm');
add('02','Marché du Faubourg d’Isle','Saint-Quentin',{dimanche:'8h30-12h30'},'Boulevard Cordier, entre la rue d’Ostende et le boulevard Camille-Guérin, 02100 Saint-Quentin','https://www.saint-quentin.fr/TPL_CODE/TPL_ANNUAIRE/PAR_TPL_IDENTIFIANT/126/1344-annuaire.htm');

add('02','Marché du Centre historique','Laon',{mardi:'15h-19h'},'Place du Général-Leclerc, 02000 Laon','https://www.laon.fr/VILLE_LAON_21_WEB/FR/Accueil.awp?ar=178&m=7.128&page=151');
add('02','Marché du quartier Champagne','Laon',{mardi:'13h-18h',samedi:'13h30-18h'},'Place du 8-Mai-1945, 02000 Laon','https://www.laon.fr/VILLE_LAON_21_WEB/FR/Accueil.awp?ar=178&m=7.128&page=151');
add('02','Marché de Vaux et Halles de Laon','Laon',{jeudi:'8h-13h',samedi:'Matin — horaire exact à vérifier'},'Place Victor-Hugo et Halles de Laon, 02000 Laon','https://www.laon.fr/VILLE_LAON_21_WEB/FR/Accueil.awp?ar=178&m=7.128&page=151');
add('02','Marché d’Ardon','Laon',{dimanche:'8h-13h30'},'Place d’Ardon, 02000 Laon','https://www.laon.fr/VILLE_LAON_21_WEB/FR/Accueil.awp?ar=178&m=7.128&page=151');

add('55','Marché couvert de Verdun','Verdun',{vendredi:'8h-13h'},'Place du Marché-Couvert, 55100 Verdun','https://www.verdun.fr/services-au-quotidien/marches-foires-brocantes/marche-couvert/');
add('55','Marché couvert de Bar-le-Duc','Bar-le-Duc',{mardi:'7h15-12h30',jeudi:'7h15-12h30',samedi:'7h15-12h30'},'Marché couvert, rue du Four, 55000 Bar-le-Duc','https://www.barleduc.fr/mon-quotidien/commerces/marches/marche-couvert');

add('60','Marché du quartier Argentine','Beauvais',{lundi:'8h-14h'},'Place de France et avenue Jean-Moulin, 60000 Beauvais','https://www.beauvais.fr/docs/actualites/1409-marche.pdf');
add('60','Marché du Centre-Ville','Beauvais',{mercredi:'7h-18h',samedi:'7h-18h'},'Place des Halles et rue Louvet, 60000 Beauvais','https://www.beauvais.fr/docs/actualites/1409-marche.pdf');
add('60','Marché du quartier Saint-Lucien','Beauvais',{jeudi:'8h-12h30'},'Avenue de l’Europe, 60000 Beauvais','https://www.beauvais.fr/docs/actualites/1409-marche.pdf');

add('60','Marché de la place Carnot','Creil',{mercredi:'7h45-13h d’avril à septembre ; 7h45-12h30 d’octobre à mars',samedi:'7h45-13h d’avril à septembre ; 7h45-12h30 d’octobre à mars'},'Place Carnot, 60100 Creil','https://www.creil.fr/marches-et-foires');
add('60','Marché du Champ de Mars','Creil',{jeudi:'7h45-13h d’avril à septembre ; 7h45-12h30 d’octobre à mars'},'Champ de Mars, 60100 Creil','https://www.creil.fr/marches-et-foires');

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'')}
function apply(target,near){if(!Array.isArray(target))return;for(var j=0;j<rows.length;j++){var r=rows[j],found=-1;for(var i=0;i<target.length;i++){if(String(target[i][0])===String(r[0])&&norm(target[i][2])===norm(r[2])&&norm(target[i][3])===norm(r[3])&&norm(target[i][4])===norm(r[4])){found=i;break}}var value=near?[r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[10],r[11],[r[3],r[2],r[8]].join(', '),r[12],r[13],'','','']:r;if(found>=0)target[found]=value;else target.push(value)}}
apply(window.data,false);apply(window.NEAR_FR,true);window.MARCHES_MISSING_V101_COUNT=rows.length;
})();
