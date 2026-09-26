/* Sukhna Lake, Chandigarh.  Everything the planet layout reads (plan §3).
 * {{bbox}} is replaced by fetch-osm.mjs with "south,west,north,east". */
[out:json][timeout:120];
(
  nwr["natural"="water"]({{bbox}});
  nwr["water"]({{bbox}});
  nwr["place"="islet"]({{bbox}});
  nwr["waterway"]({{bbox}});
  nwr["man_made"~"^(dyke|embankment|pier|breakwater|tower|flagpole|water_works)$"]({{bbox}});
  nwr["leisure"~"^(slipway|marina|park|garden|golf_course|pitch|playground|nature_reserve|fitness_station)$"]({{bbox}});
  way["highway"]({{bbox}});
  nwr["amenity"]({{bbox}});
  nwr["golf"]({{bbox}});
  nwr["building"]({{bbox}});
  nwr["landuse"]({{bbox}});
  nwr["natural"~"^(wood|scrub|tree_row|wetland|grassland|heath|beach|sand|bare_rock)$"]({{bbox}});
  node["natural"="tree"]({{bbox}});
  nwr["tourism"]({{bbox}});
  nwr["historic"]({{bbox}});
  nwr["barrier"~"^(wall|fence|retaining_wall|gate)$"]({{bbox}});
  node["name"]({{bbox}});
  nwr["boundary"="protected_area"]({{bbox}});
);
out body geom;
