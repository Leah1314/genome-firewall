const ANTIBIOTICS = [
  {
    id: "ciprofloxacin",
    label: "Ciprofloxacin",
    target: "DNA gyrase / topoisomerase IV",
    markers: [/^qnr/i, /gyrA/i, /parC/i, /aac\(6['’-]?\)-Ib-cr/i],
    intercept: -2.2,
    markerWeight: 3.1,
    mutationWeight: 1.25,
  },
  {
    id: "ceftriaxone",
    label: "Ceftriaxone",
    target: "Penicillin-binding proteins",
    markers: [/blaCTX-M/i, /blaCMY/i, /blaSHV/i, /ESBL/i],
    intercept: -2.0,
    markerWeight: 3.0,
    mutationWeight: 0.8,
  },
  {
    id: "gentamicin",
    label: "Gentamicin",
    target: "30S ribosomal subunit",
    markers: [/aac\(3/i, /aac\(6/i, /ant\(2/i, /aph\(2/i, /16S/i],
    intercept: -2.1,
    markerWeight: 2.95,
    mutationWeight: 1.0,
  },
];

const SUPPORTED_SPECIES = {
  "escherichia coli": {
    label: "Escherichia coli",
    amrFinderOrganism: "Escherichia",
    expectedGenomeRange: [3_500_000, 6_500_000],
  },
};

module.exports = { ANTIBIOTICS, SUPPORTED_SPECIES };
