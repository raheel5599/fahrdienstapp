import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { loadActiveTaxiRides, loadTaxiLocations } from '../data/taxiLive.js';

const fmtTime = value => value
  ? new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  : '—';

export default function TaxiLiveOffice() {
  const [rides, setRides] = useState([]);
  const [locations, setLocations] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    try { const [rideResult, locationResult] = await Promise.all([
      loadActiveTaxiRides(),
      loadTaxiLocations()
    ]);

    if (rideResult.ok) {
      setRides(rideResult.rides);
      setError('');
    } else {
      setError(rideResult.message || 'Live-Fahrten konnten nicht geladen werden.');
    }

    setLocations(locationResult.ok ? locationResult.locations : []);
    } catch(e){setError(e.message);}
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const locationByRide = useMemo(
    () => Object.fromEntries(locations.map(item => [item.ride_id, item])),
    [locations]
  );

  return (
    <section className="panel taxi-office-live">
      <div className="panel-title">
        <div><MapPin size={19}/><strong>Taxi Live-Status</strong></div>
        <span className="live-label"><span/> LIVE</span>
      </div>

      {error && <p className="taxi-live-error">{error}</p>}

      {!rides.length ? (
        <div className="taxi-empty">Aktuell keine aktive Taxifahrt.</div>
      ) : (
        <div className="taxi-office-list">
          {rides.map(ride => {
            const loc = locationByRide[ride.id];
            const navTarget = ride.destination_address
              ? 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(ride.destination_address)
              : '';

            return (
              <article className="taxi-office-row" key={ride.id}>
                <div className="taxi-office-status">
                  <span className="taxi-live-dot occupied"/>
                  <div>
                    <strong>{ride.status === 'occupied' ? 'Besetzt' : ride.status}</strong>
                    <small>{ride.source === 'hale' ? 'HALE' : ride.source === 'office' ? 'Zentrale' : 'Fahrer-App'} · seit {fmtTime(ride.started_at)}</small>
                  </div>
                </div>
                <div>
                  <span>Von</span>
                  <strong>{ride.pickup_address || 'GPS-Abfahrt gespeichert'}</strong>
                </div>
                <div>
                  <span>Nach</span>
                  <strong>{ride.destination_address || 'Ziel noch nicht angegeben'}</strong>
                </div>
                <div>
                  <span>Live-Position</span>
                  <strong>{loc ? loc.latitude.toFixed(5) + ', ' + loc.longitude.toFixed(5) : 'wird ermittelt'}</strong>
                  <small>{loc ? 'Stand ' + fmtTime(loc.updated_at) : ''}</small>
                </div>
                {navTarget
                  ? <a className="row-action" target="_blank" rel="noreferrer" href={navTarget}><Navigation size={15}/> Route</a>
                  : <span/>
                }
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
