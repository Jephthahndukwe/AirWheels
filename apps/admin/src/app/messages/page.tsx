import { ActionForm, Field, Select, Submit } from '@/components/form';
import { Badge, Card, Table, Td } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { addTemplateVersion, approveTemplate } from '../traveller-actions';

export const dynamic = 'force-dynamic';

interface Version {
  id: string;
  version: number;
  body: string;
  approved: boolean;
  providerName: string | null;
  channel: string;
}
interface EventRow {
  event: string;
  label: string;
  buttons: { intent: string; title: string }[];
  initiated: boolean;
  defaultBody: string;
  channels: { channel: string; versions: Version[]; inherited: Version | null }[];
}

const VARS =
  'serviceName, firstName, trackingUrl, legsSummary, pickupTime, pickupArea, dropoffArea, pickupCode, driverFirstName, car, carColour, plate, minutesAway, meetingPoint, freeWaitMinutes, reason, flightNumber, options, cost, stopNumber, stopCount, coTravellers';

/**
 * Message templates per airline and event (TRV-01, ADM-09). Every save is a new version, checked so it
 * can never carry a full name, a full address, or a pickup code in a message that is not the
 * traveller's own. Super admins edit; staff read.
 */
export default async function Messages({
  searchParams,
}: {
  searchParams: Promise<{ airlineId?: string }>;
}) {
  const me = await requireMe();
  const { airlineId } = await searchParams;
  const [airlines, t] = await Promise.all([
    api<{ id: string; name: string; code: string }[]>('/v1/admin/airlines'),
    api<{ events: EventRow[] }>(
      `/v1/admin/message-templates${airlineId ? `?airlineId=${airlineId}` : ''}`,
    ),
  ]);
  const edit = can.superAdmin(me);
  const scope = airlines.find((a) => a.id === airlineId);
  return (
    <div className="max-w-6xl">
      <h1 className="mb-2 text-2xl font-bold">Traveller messages</h1>
      <p className="mb-4 text-sm text-slate">
        WhatsApp first, SMS if WhatsApp fails or is not delivered in time. Outside the 24-hour
        window only WhatsApp templates approved by Meta are sent.
      </p>
      <form className="mb-6 flex items-center gap-3 text-sm">
        <select
          name="airlineId"
          defaultValue={airlineId ?? ''}
          className="rounded-md border border-border bg-white px-3 py-2"
        >
          <option value="">Airwheels defaults (own channel, and airlines without their own)</option>
          {airlines.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.code})
            </option>
          ))}
        </select>
        <button className="rounded-md bg-ink px-4 py-2 text-white">Show</button>
      </form>

      {edit && (
        <Card title={`New version for ${scope ? scope.name : 'Airwheels defaults'}`}>
          <ActionForm action={addTemplateVersion} className="grid grid-cols-4 gap-3">
            <input type="hidden" name="airlineId" value={airlineId ?? ''} />
            <Select
              label="Message"
              name="event"
              options={t.events.map((e): [string, string] => [e.event, e.label])}
            />
            <Select
              label="Channel"
              name="channel"
              options={[
                ['WHATSAPP', 'WhatsApp'],
                ['SMS', 'SMS'],
                ['EMAIL', 'Email'],
              ]}
            />
            <Field
              label="Meta template name (WhatsApp)"
              name="providerName"
              placeholder="driver_assigned"
            />
            <span />
            <label className="col-span-4 block text-sm">
              <span className="mb-1 block font-medium">Text</span>
              <textarea
                name="body"
                required
                rows={3}
                className="w-full rounded-md border border-border p-2 font-mono text-xs"
              />
              <span className="mt-1 block text-xs text-slate">
                Variables in double braces: {VARS}.
              </span>
            </label>
            <div className="col-span-4">
              <Submit>Save version</Submit>
            </div>
          </ActionForm>
        </Card>
      )}

      <Table head={['Message', 'Channel', 'Text in use', 'Status']}>
        {t.events.flatMap((e) =>
          e.channels.map((c, i) => {
            const own = c.versions[0];
            const v = own ?? c.inherited;
            return (
              <tr key={`${e.event}-${c.channel}`}>
                <Td>
                  {i === 0 && (
                    <>
                      <span className="font-semibold">{e.label}</span>
                      <span className="block font-mono text-[10px] text-slate">{e.event}</span>
                      {e.buttons.length > 0 && (
                        <span className="block text-xs text-slate">
                          Buttons: {e.buttons.map((b) => b.title).join(' · ')}
                        </span>
                      )}
                    </>
                  )}
                </Td>
                <Td>{c.channel.toLowerCase()}</Td>
                <Td>
                  <span className="block max-w-xl whitespace-pre-wrap font-mono text-[11px]">
                    {v?.body ?? e.defaultBody}
                  </span>
                </Td>
                <Td>
                  {!v ? (
                    <Badge>built-in</Badge>
                  ) : !own ? (
                    <Badge>default</Badge>
                  ) : (
                    <>
                      v{own.version}{' '}
                      {c.channel === 'WHATSAPP' &&
                        (own.approved ? (
                          <Badge tone="good">approved {own.providerName}</Badge>
                        ) : (
                          <Badge tone="warn">awaiting Meta</Badge>
                        ))}
                      {edit && c.channel === 'WHATSAPP' && !own.approved && (
                        <ActionForm
                          action={approveTemplate.bind(null, own.id)}
                          className="mt-2 flex items-end gap-2"
                        >
                          <Field
                            label="Approved name"
                            name="providerName"
                            required
                            defaultValue={own.providerName ?? e.event.replace(/\./g, '_')}
                          />
                          <Submit variant="secondary">Mark approved</Submit>
                        </ActionForm>
                      )}
                    </>
                  )}
                </Td>
              </tr>
            );
          }),
        )}
      </Table>
    </div>
  );
}
