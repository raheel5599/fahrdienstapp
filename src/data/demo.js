export const initialTrips = [
  {
    id: 'F-1024', time: '08:00', patient: 'Müller, Anna', type: 'Dialyse',
    from: 'Florstadt, Altenstädter Str. 8', to: 'Dialysezentrum Friedberg',
    driver: 'Ahmad', vehicle: 'FB-TT 5599', status: 'abgeschlossen',
    wheelchair: true, audit: []
  },
  {
    id: 'F-1025', time: '09:30', patient: 'Schmidt, Karl', type: 'Chemotherapie',
    from: 'Florstadt, Lindenstraße 12', to: 'St. Johannes Hospital Frankfurt',
    driver: 'Imran', vehicle: 'FB-VD 5599', status: 'in_fahrt',
    wheelchair: false, audit: []
  },
  {
    id: 'F-1026', time: '11:00', patient: 'Yilmaz, Mehmet', type: 'Arztfahrt',
    from: 'Reichelsheim, Hauptstraße 31', to: 'Praxis Dr. Weber, Bad Nauheim',
    driver: 'Bilal', vehicle: 'FB-CM 5599', status: 'auf_dem_weg',
    wheelchair: false, audit: []
  },
  {
    id: 'F-1027', time: '13:15', patient: 'Becker, Lisa', type: 'Reha',
    from: 'Friedberg, Kaiserstraße 47', to: 'MediClin Bad Orb',
    driver: 'Hamza', vehicle: 'FB-TT 5600', status: 'geplant',
    wheelchair: true, audit: []
  },
  {
    id: 'F-1028', time: '15:00', patient: 'Schneider, Thomas', type: 'Krankenhaus',
    from: 'Bad Nauheim, Parkstraße 3', to: 'Knappschaftsklinik',
    driver: '', vehicle: '', status: 'offen',
    wheelchair: false, audit: []
  },
  {
    id: 'F-1029', time: '16:30', patient: 'Özdemir, Fatma', type: 'Dialyse',
    from: 'Florstadt, Am Mühlbach 18', to: 'Dialysezentrum Bad Vilbel',
    driver: 'Ali', vehicle: 'FB-CM 5599', status: 'geplant',
    wheelchair: false, audit: []
  }
];

export const driversSeed = [
  { id: 'DRV-001', name: 'Ahmad', vehicle: 'FB-TT 5599', status: 'frei' },
  { id: 'DRV-002', name: 'Imran', vehicle: 'FB-VD 5599', status: 'in_fahrt' },
  { id: 'DRV-003', name: 'Bilal', vehicle: 'FB-CM 5599', status: 'auf_dem_weg' },
  { id: 'DRV-004', name: 'Hamza', vehicle: 'FB-TT 5600', status: 'frei' },
  { id: 'DRV-005', name: 'Ali', vehicle: 'FB-CM 5599', status: 'frei' },
  { id: 'DRV-006', name: 'Yusuf', vehicle: 'FB-XX 5601', status: 'frei' }
];
