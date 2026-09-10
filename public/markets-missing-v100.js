(function(){
'use strict';
var rows=[],D=['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
function add(dept,name,city,schedule,address,source,draw,registration){Object.keys(schedule).forEach(function(day){rows.push([dept,'marche',name,city,day,schedule[day],'Marché municipal hebdomadaire — horaires et adresse publiés par la commune.','Non publié officiellement',address,[source],null,null,draw||'Non publié officiellement',registration||'Contacter la mairie ou le placier'])})}

add('90','Marché des Résidences','Belfort',{mercredi:'7h-12h'},'Quartier des Résidences, 90000 Belfort','https://www.belfort.fr/commerce-et-economie/commerce-non-sedentaire','Tirage au sort à 8h00','Inscription des passagers de 7h30 à 7h45');
add('90','Marché couvert des Vosges','Belfort',{jeudi:'7h-12h',dimanche:'7h-13h'},'Marché des Vosges, avenue Jean-Jaurès, 90000 Belfort','https://www.belfort.fr/commerce-et-economie/commerce-non-sedentaire','Dimanche : tirage au sort à 8h00','Contacter la mairie ou le placier');
add('90','Marché couvert Fréry','Belfort',{vendredi:'7h-12h',samedi:'7h-13h'},'Marché Fréry, rue du Docteur-Fréry, 90000 Belfort','https://www.belfort.fr/commerce-et-economie/commerce-non-sedentaire','Non publié officiellement','Contacter la mairie ou le placier');

add('10','Marché central des Halles','Troyes',{lundi:'8h-13h',mardi:'8h-13h et 15h30-19h',mercredi:'8h-13h et 15h30-19h',jeudi:'8h-13h et 15h30-19h',vendredi:'7h-19h',samedi:'7h-19h',dimanche:'9h-13h'},'Rue Claude-Huez, 10000 Troyes','https://www.ville-troyes.fr/au-quotidien/commerces-artisanat/marches/','Samedi : tirage au sort de 7h15 à 7h30 ; dimanche de 8h15 à 8h30','Passagers acceptés selon les places disponibles');
add('10','Marché extérieur des Halles','Troyes',{mercredi:'8h-17h',vendredi:'8h-17h',samedi:'8h-14h'},'Autour des Halles, rue Claude-Huez, 10000 Troyes','https://www.ville-troyes.fr/au-quotidien/commerces-artisanat/marches/','Samedi : tirage au sort de 7h15 à 7h30','Passagers acceptés selon les places disponibles');
add('10','Marché extérieur des Chartreux','Troyes',{dimanche:'8h-13h'},'Place Romain-Rolland, 10000 Troyes','https://www.ville-troyes.fr/au-quotidien/commerces-artisanat/marches/','Tirage au sort de 8h15 à 8h30','Passagers acceptés selon les places disponibles');

add('2A','Marché central d’Ajaccio','Ajaccio',{mardi:'7h-14h',mercredi:'7h-14h',jeudi:'7h-14h',vendredi:'7h-14h',samedi:'7h-14h',dimanche:'7h-14h'},'Place Campinchi, 20000 Ajaccio','https://www.ajaccio.fr/file/240122/','Placement par le placier','Emplacements journaliers sur dossier municipal');
add('2A','Marché des produits manufacturés','Ajaccio',{dimanche:'7h-12h30'},'Boulevard Roi-Jérôme, 20000 Ajaccio','https://www.ajaccio.fr/file/240122/','Placement par le placier','Emplacements journaliers sur dossier municipal');
add('2A','Halle gourmande','Ajaccio',{samedi:'7h-14h',dimanche:'7h-14h'},'Boulevard Lantivy, 20000 Ajaccio','https://www.ajaccio.fr/file/240122/','Placement par le placier','Emplacements journaliers sur dossier municipal');

add('51','Marché Saint-Thomas','Reims',{lundi:'5h-13h'},'Place Saint-Thomas, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché Jean-Moulin','Reims',{mardi:'5h-13h'},'Parking de la place Jean-Moulin, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché rue Simon','Reims',{mardi:'5h-13h'},'Rue Simon, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché des Châtillons','Reims',{mercredi:'5h-13h'},'Parking Georges-Hodin, quartier Châtillons, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché couvert du Boulingrin','Reims',{mercredi:'7h-13h',vendredi:'7h-13h',samedi:'6h-14h'},'Halles du Boulingrin, 50 rue de Mars, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché Carteret','Reims',{jeudi:'5h-13h'},'Boulevard Carteret, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché Luton','Reims',{jeudi:'5h-13h'},'Place Luton, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché Wilson','Reims',{vendredi:'5h-13h'},'Boulevard Wilson, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché Croix-Rouge','Reims',{samedi:'5h-13h'},'Rue Pierre-Taittinger, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché Jean-Jaurès','Reims',{dimanche:'5h-13h'},'Avenue Jean-Jaurès, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');
add('51','Marché Sainte-Anne','Reims',{dimanche:'5h-13h'},'Rue de Louvois, 51100 Reims','https://en.reims.fr/visit-reims/reims-markets');

add('972','Grand Marché couvert aux épices','Fort-de-France',{lundi:'6h-16h',mardi:'6h-16h',mercredi:'6h-16h',jeudi:'6h-16h',vendredi:'6h-16h',samedi:'6h-15h'},'Angle des rues Antoine-Siger et Isambert, 97200 Fort-de-France','https://www.fortdefrance.fr/point-d-interet/marche-couvert-dit-marche-aux-epices/');

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'')}
function apply(target,near){if(!Array.isArray(target))return;for(var j=0;j<rows.length;j++){var r=rows[j],found=-1;for(var i=0;i<target.length;i++){if(String(target[i][0])===String(r[0])&&norm(target[i][2])===norm(r[2])&&norm(target[i][3])===norm(r[3])&&norm(target[i][4])===norm(r[4])){found=i;break}}var value=near?[r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[10],r[11],[r[3],r[2],r[8]].join(', '),r[12],r[13],'','','']:r;if(found>=0)target[found]=value;else target.push(value)}}
apply(window.data,false);apply(window.NEAR_FR,true);window.MARCHES_MISSING_V100_COUNT=rows.length;
})();
