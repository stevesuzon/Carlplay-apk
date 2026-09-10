(function(){
'use strict';var rows=[];
function add(dept,name,city,schedule,address,source){Object.keys(schedule).forEach(function(day){rows.push([dept,'marche',name,city,day,schedule[day],'Marché municipal récurrent — jour, horaire et lieu repris de la publication officielle.','Non publié officiellement',address,[source],null,null,'Non publié officiellement','Contacter la mairie ou le placier'])})}

add('46','Marché de Cahors','Cahors',{mercredi:'8h-13h',samedi:'8h-13h'},'Allées Fénelon pendant les travaux de la place Chapou, 46000 Cahors','https://cahorsagglo.fr/les-marches-sur-les-allees-fenelon');
add('46','Marché de Catus','Catus',{mardi:'8h-13h'},'Boulevard Gustave-Larroumet, face à la mairie, 46150 Catus','https://cahorsagglo.fr/les-marches');
add('46','Marché d’Espère','Espère',{dimanche:'8h-13h'},'Place du Marché, angle rue Principale et rue du Clau, 46090 Espère','https://cahorsagglo.fr/les-marches');
add('46','Marché de Lamagdelaine','Lamagdelaine',{samedi:'8h-13h'},'Place de la salle des fêtes, 46090 Lamagdelaine','https://cahorsagglo.fr/les-marches');
add('46','Marché de Mercuès','Mercuès',{jeudi:'8h-13h'},'Place Raymond-Durand, devant la mairie, 46090 Mercuès','https://cahorsagglo.fr/les-marches');
add('46','Marché de Pradines','Pradines',{vendredi:'15h-19h en hiver ; 16h-20h en été'},'Route du Gymnase, quartier Labéraudie, 46090 Pradines','https://cahorsagglo.fr/les-marches');
add('46','Marché de Saint-Géry','Saint-Géry-Vers',{dimanche:'8h-13h'},'Domaine du Porche, avenue de l’Europe, 46330 Saint-Géry','https://cahorsagglo.fr/les-marches');
add('46','Marché de Saint-Pierre-Lafeuille','Saint-Pierre-Lafeuille',{mercredi:'Toute la journée'},'Place de la Mairie, 46090 Saint-Pierre-Lafeuille','https://cahorsagglo.fr/les-marches');

add('05','Marché du mercredi de Gap','Gap',{mercredi:'8h-12h'},'Place de la République, 05000 Gap','https://www.gap-tallard-durance.fr/fr/agenda/fiche-detail/marche-hebdomadaire-du-mercredi/');
add('05','Marché du samedi de Gap','Gap',{samedi:'8h-12h'},'Rue Carnot, place Alsace-Lorraine, rue de France et rue Élysée, 05000 Gap','https://www.gap-tallard-durance.fr/fr/agenda/fiche-detail/marche-hebdomadaire-du-samedi/');
add('05','Marché de Tallard','Tallard',{mardi:'8h-12h',vendredi:'8h-12h'},'Place Commandant-Dumont, 05130 Tallard','https://www.gap-tallard-durance.fr/fr/agenda/fiche-detail/marche-hebdomadaire/');

add('87','Marché de La Bastide','Limoges',{mardi:'7h-13h',jeudi:'7h-13h'},'Cité Léon-Jouhaux et allée Seurat, 87000 Limoges','https://www.limoges.fr/pratique/halles-et-marches');
add('87','Marché du Val de l’Aurence','Limoges',{mercredi:'7h-13h'},'Quartier Val de l’Aurence, 87000 Limoges','https://www.limoges.fr/pratique/halles-et-marches');
add('87','Marché de Corgnac','Limoges',{jeudi:'7h-13h'},'Place du Commerce, quartier Corgnac, 87000 Limoges','https://www.limoges.fr/pratique/halles-et-marches');
add('87','Marché des Longes','Limoges',{jeudi:'7h-13h'},'Quartier des Longes, 87000 Limoges','https://www.limoges.fr/pratique/halles-et-marches');
add('87','Marché de Beaubreuil','Limoges',{vendredi:'7h-13h'},'Quartier Beaubreuil, 87000 Limoges','https://www.limoges.fr/pratique/halles-et-marches');
add('87','Marché du Vigenal','Limoges',{vendredi:'15h-20h'},'Quartier du Vigenal, 87000 Limoges','https://www.limoges.fr/pratique/halles-et-marches');
add('87','Marché Marceau','Limoges',{samedi:'7h-13h'},'Place Marceau, 87000 Limoges','https://www.limoges.fr/pratique/halles-et-marches');
add('87','Marché des Carmes','Limoges',{samedi:'7h-13h'},'Place des Carmes, 87000 Limoges','https://www.limoges.fr/pratique/halles-et-marches');
add('87','Marché de Landouge','Limoges',{dimanche:'7h-13h'},'Esplanade avenue de Landouge, près de la salle des fêtes, 87100 Limoges','https://www.limoges.fr/pratique/halles-et-marches');

add('25','Marché de la Révolution','Besançon',{mardi:'7h-13h',vendredi:'7h-13h',samedi:'7h-18h'},'Place de la Révolution, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');
add('25','Marché des Époisses','Besançon',{mardi:'7h-13h',vendredi:'7h-13h'},'Quartier Planoise, secteur Époisses, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');
add('25','Marché Cassin','Besançon',{mercredi:'7h-18h',samedi:'7h-18h'},'Place Cassin, quartier Planoise, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');
add('25','Marché de Palente','Besançon',{mercredi:'7h-13h',samedi:'7h-13h'},'Place des Tilleuls, quartier Palente, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');
add('25','Marché Île-de-France','Besançon',{jeudi:'7h-13h',dimanche:'7h-13h'},'Quartier Planoise, secteur Île-de-France, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');
add('25','Marché Jouffroy-d’Abbans','Besançon',{dimanche:'7h-13h'},'Place Jouffroy-d’Abbans, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');
add('25','Marché Saint-Ferjeux','Besançon',{dimanche:'7h-13h'},'Place de la Bascule, quartier Saint-Ferjeux, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');
add('25','Marché de Rivotte','Besançon',{dimanche:'8h-13h'},'Place des Jacobins, quartier Rivotte, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');
add('25','Halles Beaux-Arts','Besançon',{mardi:'7h-14h',mercredi:'7h-14h',jeudi:'7h-14h',vendredi:'7h-18h30',samedi:'7h-18h30',dimanche:'8h-13h'},'Marché couvert des Beaux-Arts, rue Goudimel, 25000 Besançon','https://www.grandbesancon.fr/infos-pratiques/environnement/pour-une-alimentation-saine-durable-et-plus-locale/les-marches/');

add('53','Marché central de Laval','Laval',{mardi:'8h-13h30',samedi:'8h-13h30'},'Château-Neuf le mardi ; places des Acacias, Saint-Tugal, de la Trémoille et rues voisines le samedi, 53000 Laval','https://www.laval.fr/au-quotidien/commerces-et-marches/marches-hebdomadaires');
add('53','Marché du Bourny','Laval',{mercredi:'Matin — horaire exact à vérifier'},'Place de la Commune, quartier du Bourny, 53000 Laval','https://www.laval.fr/au-quotidien/commerces-et-marches/marches-hebdomadaires');
add('53','Marché Murat','Laval',{vendredi:'Matin — horaire exact à vérifier'},'Rue Oudinot, quartier Murat, 53000 Laval','https://www.laval.fr/au-quotidien/commerces-et-marches/marches-hebdomadaires');
add('53','Marché de la Gare','Laval',{samedi:'Matin — horaire exact à vérifier'},'Bas du parvis de la gare, 53000 Laval','https://www.laval.fr/au-quotidien/commerces-et-marches/marches-hebdomadaires');

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'')}
function apply(target,near){if(!Array.isArray(target))return;for(var j=0;j<rows.length;j++){var r=rows[j],found=-1;for(var i=0;i<target.length;i++){if(String(target[i][0])===String(r[0])&&norm(target[i][2])===norm(r[2])&&norm(target[i][3])===norm(r[3])&&norm(target[i][4])===norm(r[4])){found=i;break}}var value=near?[r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[10],r[11],[r[3],r[2],r[8]].join(', '),r[12],r[13],'','','']:r;if(found>=0)target[found]=value;else target.push(value)}}
apply(window.data,false);apply(window.NEAR_FR,true);window.MARCHES_MISSING_V103_COUNT=rows.length;
})();
