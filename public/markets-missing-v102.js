(function(){
'use strict';
var rows=[];
function add(dept,name,city,schedule,address,source,draw,registration){Object.keys(schedule).forEach(function(day){rows.push([dept,'marche',name,city,day,schedule[day],'Marché municipal hebdomadaire — jour, lieu et horaires repris de la publication communale.','Non publié officiellement',address,[source],null,null,draw||'Non publié officiellement',registration||'Contacter la mairie ou le placier'])})}

add('08','Marché couvert et extérieur','Charleville-Mézières',{mardi:'8h-13h',jeudi:'8h-13h',samedi:'8h-13h'},'Rue du Daga, 08000 Charleville-Mézières','https://www.charleville-mezieres.fr/les-marches-brocantes-et-braderies','Tirage au sort de 7h30 à 8h','Demande écrite au service Occupation du Domaine Public');
add('08','Marché de la Ronde Couture','Charleville-Mézières',{dimanche:'8h-13h'},'Place Bauchart, 08000 Charleville-Mézières','https://www.charleville-mezieres.fr/les-marches-brocantes-et-braderies','Tirage au sort de 7h30 à 8h','Demande écrite au service Occupation du Domaine Public');
add('08','Marché de l’Hôtel de Ville','Charleville-Mézières',{mercredi:'8h-13h'},'Place de l’Hôtel-de-Ville, Mézières, 08000 Charleville-Mézières','https://www.charleville-mezieres.fr/les-marches-brocantes-et-braderies','Tirage au sort de 7h30 à 8h','Demande écrite au service Occupation du Domaine Public');
add('08','Marché de Mohon','Charleville-Mézières',{vendredi:'8h-13h'},'Place de Mohon, 08000 Charleville-Mézières','https://www.charleville-mezieres.fr/les-marches-brocantes-et-braderies','Tirage au sort de 7h30 à 8h','Demande écrite au service Occupation du Domaine Public');

add('19','Marché de la Guierle et halle Brassens','Brive-la-Gaillarde',{mardi:'Matin — horaire exact à vérifier',jeudi:'Matin — horaire exact à vérifier',samedi:'Matin — horaire exact à vérifier'},'Place de la Guierle et halle Georges-Brassens, 19100 Brive-la-Gaillarde','https://www.brive.fr/foires-marches/marches-traditionnels/');
add('19','Marché place Thiers','Brive-la-Gaillarde',{mardi:'Matin — horaire exact à vérifier',samedi:'Matin — horaire exact à vérifier'},'Place Thiers, place de Lattre-de-Tassigny, 19100 Brive-la-Gaillarde','https://www.brive.fr/foires-marches/marches-traditionnels/');
add('19','Marché de Tujac','Brive-la-Gaillarde',{vendredi:'Matin — horaire exact à vérifier'},'Place Jacques-Cartier, quartier Tujac, 19100 Brive-la-Gaillarde','https://www.brive.fr/foires-marches/marches-traditionnels/');

add('2B','Marché communal de Corte','Corte',{vendredi:'8h-13h'},'Place Padoue ; place Porette le premier vendredi du mois, 20250 Corte','https://mairie-corte.fr/catalog_repository/uploads/7/Rglement_gnral_du_march_%289%29.pdf','Non publié officiellement','Commerçants occasionnels : demande auprès de la régie des marchés');

add('48','Marché du mercredi de Mende','Mende',{mercredi:'Matin — horaire exact à vérifier'},'Place Chaptal et place au Blé, 48000 Mende','https://mende.fr/le-marche/');
add('48','Marché du samedi de Mende','Mende',{samedi:'Matin — horaire exact à vérifier'},'Places Urbain-V et Chaptal du 1er avril au 31 octobre ; Espace Événements Georges-Frêche, place du Foirail, en hiver, 48000 Mende','https://mende.fr/le-marche/');

add('52','Marché des Halles de Chaumont','Chaumont',{samedi:'Matin — horaire exact à vérifier'},'Halles de Chaumont, 52000 Chaumont','https://www.ville-chaumont.fr/actualites/marche-de-printemps-2026/');
add('52','Marché des Halles de Saint-Dizier','Saint-Dizier',{mercredi:'7h30-14h',jeudi:'7h30-14h',vendredi:'16h-20h',samedi:'7h30-14h'},'Les Halles, rue du Marché, 52100 Saint-Dizier','https://www.saint-dizier.fr/actualites-et-sorties/commerces-foires-et-marches/jours-de-marche/');
add('52','Marché du Vert-Bois','Saint-Dizier',{dimanche:'8h-12h30'},'Avenue Edgard-Pisani, 52100 Saint-Dizier','https://www.saint-dizier.fr/actualites-et-sorties/commerces-foires-et-marches/jours-de-marche/');
add('52','Marché de Montier-en-Der','La Porte du Der',{vendredi:'8h-12h'},'Place Notre-Dame, Montier-en-Der, 52220 La Porte du Der','https://www.saint-dizier.fr/actualites-et-sorties/commerces-foires-et-marches/jours-de-marche/');
add('52','Marché de Wassy','Wassy',{jeudi:'8h-12h'},'Rue du Général-Leclerc, 52130 Wassy','https://www.saint-dizier.fr/actualites-et-sorties/commerces-foires-et-marches/jours-de-marche/');

add('58','Marché de plein air Carnot','Nevers',{samedi:'8h-13h'},'Place Carnot, rue Saint-Didier, avenue Général-de-Gaulle et rue Saint-Martin, 58000 Nevers','https://www.nevers.fr/vivre-a-nevers/commerce/les-marches-de-nevers');
add('58','Marché Grande-Pâture','Nevers',{jeudi:'8h-13h30'},'Rue du Maréchal-Lyautey, 58000 Nevers','https://www.nevers.fr/vivre-a-nevers/commerce/les-marches-de-nevers');
add('58','Marché de la Résistance','Nevers',{vendredi:'15h-19h'},'Place de la Résistance, 58000 Nevers','https://www.nevers.fr/vivre-a-nevers/commerce/les-marches-de-nevers');
add('58','Marché couvert Carnot','Nevers',{mardi:'7h-13h',mercredi:'7h-13h',jeudi:'7h-13h',vendredi:'7h-13h et 15h-18h',samedi:'8h-13h'},'10 avenue Général-de-Gaulle et rue Saint-Didier, 58000 Nevers','https://www.nevers.fr/vivre-a-nevers/commerce/les-marches-de-nevers');

add('61','Marché de Perseigne','Alençon',{mardi:'Matin — horaire exact à vérifier'},'Place de la Paix et rue Verlaine, 61000 Alençon','https://www.alencon.fr/app/uploads/sites/2/2025/08/Livret_reglement_des_marches_ALENCON.pdf');
add('61','Marché complet du Centre-Ville','Alençon',{jeudi:'Matin — horaire exact à vérifier'},'Place de la Magdeleine, rue du Bercail, Grande Rue, rue Étoupée, place du Puits-des-Forges et place du Plénitre-Bas, 61000 Alençon','https://www.alencon.fr/app/uploads/sites/2/2025/08/Livret_reglement_des_marches_ALENCON.pdf');
add('61','Marché du samedi du Centre-Ville','Alençon',{samedi:'Matin — horaire exact à vérifier'},'Place de la Magdeleine, Grande Rue, place du Puits-des-Forges et rue du Bercail, 61000 Alençon','https://www.alencon.fr/app/uploads/sites/2/2025/08/Livret_reglement_des_marches_ALENCON.pdf');
add('61','Marché de Courteille','Alençon',{dimanche:'Matin — horaire exact à vérifier'},'Place du Point-du-Jour et rue Pierre-et-Marie-Curie, 61000 Alençon','https://www.alencon.fr/app/uploads/sites/2/2025/08/Livret_reglement_des_marches_ALENCON.pdf');

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'')}
function apply(target,near){if(!Array.isArray(target))return;for(var j=0;j<rows.length;j++){var r=rows[j],found=-1;for(var i=0;i<target.length;i++){if(String(target[i][0])===String(r[0])&&norm(target[i][2])===norm(r[2])&&norm(target[i][3])===norm(r[3])&&norm(target[i][4])===norm(r[4])){found=i;break}}var value=near?[r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[10],r[11],[r[3],r[2],r[8]].join(', '),r[12],r[13],'','','']:r;if(found>=0)target[found]=value;else target.push(value)}}
apply(window.data,false);apply(window.NEAR_FR,true);window.MARCHES_MISSING_V102_COUNT=rows.length;
})();
