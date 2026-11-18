import React from 'react';
import { medicalBrand, medicalTripTypes, taxiBrand, taxiTripTypes } from '../../supabase/functions/_shared/rideCategories.js';

export function RideTypeOptions({ current }) {
  return <>
    {current && !medicalTripTypes.includes(current) && !taxiTripTypes.includes(current) &&
      <option value={current}>{current}</option>}
    <optgroup label={medicalBrand}>
      {medicalTripTypes.map(type => <option key={type}>{type}</option>)}
    </optgroup>
    <optgroup label={taxiBrand}>
      {taxiTripTypes.map(type => <option key={type}>{type}</option>)}
    </optgroup>
  </>;
}
