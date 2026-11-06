import Link from 'next/link';
import { ActionForm, Field, Select, Submit } from '@/components/form';
import { Card, Table, Td } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { createVehicle } from '../actions';

export const dynamic = 'force-dynamic';

interface Vehicle {
  id: string;
  plate: string;
  brand: string;
  model: string;
  colour: string;
  class: string;
  seats: number;
  bagCapacity: number;
  powerType: string;
  partner: { name: string } | null;
  assignments: { driver: { id: string; firstName: string; lastName: string } }[];
}

export default async function Vehicles() {
  const me = await requireMe();
  const [vehicles, partners] = await Promise.all([
    api<Vehicle[]>('/v1/admin/vehicles'),
    api<{ id: string; name: string }[]>('/v1/admin/vehicles/partners'),
  ]);
  return (
    <div className="max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold">Vehicles and car partners</h1>
      {can.write(me) && (
        <Card title="Add a vehicle">
          <ActionForm action={createVehicle} className="grid grid-cols-4 items-end gap-3">
            <Field label="Plate" name="plate" required />
            <Field label="Brand" name="brand" required />
            <Field label="Model" name="model" required />
            <Field label="Colour" name="colour" required />
            <Select label="Class" name="class" options={[['SEDAN', 'Sedan'], ['SUV', 'SUV'], ['VAN', 'Van']]} />
            <Field label="Seats" name="seats" type="number" min={1} max={15} defaultValue={4} required />
            <Field label="Bags" name="bagCapacity" type="number" min={0} max={20} defaultValue={3} required />
            <Select label="Power" name="powerType" options={[['ELECTRIC', 'Electric'], ['HYBRID', 'Hybrid'], ['PETROL', 'Petrol']]} />
            <Select label="Car partner" name="partnerId" options={[['', 'None'], ...partners.map((p): [string, string] => [p.id, p.name])]} />
            <div>
              <Submit>Add vehicle</Submit>
            </div>
          </ActionForm>
        </Card>
      )}
      <Table head={['Plate', 'Vehicle', 'Class', 'Seats / bags', 'Power', 'Partner', 'Driver']} empty={vehicles.length === 0 && 'No vehicles yet.'}>
        {vehicles.map((v) => (
          <tr key={v.id}>
            <Td mono>{v.plate}</Td>
            <Td>
              {v.colour} {v.brand} {v.model}
            </Td>
            <Td>{v.class.toLowerCase()}</Td>
            <Td>
              {v.seats} / {v.bagCapacity}
            </Td>
            <Td>{v.powerType.toLowerCase()}</Td>
            <Td>{v.partner?.name ?? '—'}</Td>
            <Td>
              {v.assignments[0] ? (
                <Link className="underline" href={`/drivers/${v.assignments[0].driver.id}`}>
                  {v.assignments[0].driver.firstName} {v.assignments[0].driver.lastName}
                </Link>
              ) : (
                '—'
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
