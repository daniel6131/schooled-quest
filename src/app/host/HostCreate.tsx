'use client';

import { EntryShell } from '@/components/entry/EntryShell';
import {
  CTAButton,
  GhostButton,
  GlowCard,
  GradientTitle,
  HintText,
  InputLabel,
  NeonInput,
  SubtleLead,
} from '@/components/entry/primitives';
import { setLocalStorageString, useLocalStorageString } from '@/lib/persist';
import { getSocket } from '@/lib/socket';
import type { Ack, PublicRoomState } from '@/lib/types';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

const LS_NAME = 'sq_name_last';
const LS_HOST_KEY = 'sq_hostKey';
const LS_HOST_ROOM_CODE = 'sq_hostRoomCode';

export default function HostCreate() {
  const router = useRouter();
  const params = useSearchParams();

  const savedName = useLocalStorageString(LS_NAME, '');
  const queryName = (params.get('name') || '').trim();

  const [nameDraft, setNameDraft] = useState(queryName || savedName);
  const hostName = useMemo(() => nameDraft.trim(), [nameDraft]);

  const nameOk = hostName.length >= 2 && hostName.length <= 18;

  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const didCreateRef = useRef(false);

  useEffect(() => {
    // keep localStorage in sync if they came in via query
    if (queryName) setLocalStorageString(LS_NAME, queryName.slice(0, 18));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!nameOk) return;
    if (!creating) return;
    if (didCreateRef.current) return;

    didCreateRef.current = true;
    setError(null);

    const s = getSocket();
    s.emit('room:create', { hostName }, (res: Ack<{ room: PublicRoomState; hostKey: string }>) => {
      if (!res.ok) {
        setError(res.error);
        setCreating(false);
        didCreateRef.current = false;
        return;
      }

      setLocalStorageString(LS_HOST_KEY, res.data.hostKey);
      setLocalStorageString(LS_HOST_ROOM_CODE, res.data.room.code);

      router.replace(`/host/${res.data.room.code}?name=${encodeURIComponent(hostName)}`);
    });
  }, [creating, hostName, nameOk, router]);

  return (
    <EntryShell
      footer={
        <HintText>If you hosted before, your browser keeps a host key for quick re-entry.</HintText>
      }
    >
      <div className="w-full">
        <GlowCard>
          <div className="flex flex-col gap-6">
            <div className="text-center">
              <GradientTitle>Host a lobby</GradientTitle>
              <SubtleLead>We’ll generate a room code, then open your host dashboard.</SubtleLead>
            </div>

            {!creating ? (
              <>
                <div>
                  <InputLabel>Host Name</InputLabel>
                  <NeonInput
                    value={nameDraft}
                    onChange={(e) => {
                      const v = e.target.value.slice(0, 18);
                      setNameDraft(v);
                      setLocalStorageString(LS_NAME, v);
                    }}
                    placeholder="e.g. QuizMaster"
                    autoComplete="nickname"
                    inputMode="text"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && nameOk) setCreating(true);
                    }}
                  />
                  <HintText className="mt-2">{nameOk ? '✓ Ready' : '2–18 characters'}</HintText>
                </div>

                {error ? (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-200/90">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-3">
                  <CTAButton disabled={!nameOk} onClick={() => setCreating(true)}>
                    <span className="inline-flex items-center gap-2">
                      <Sparkles size={18} />
                      Summon lobby
                    </span>
                    →
                  </CTAButton>

                  <GhostButton onClick={() => router.push('/')}>
                    <ArrowLeft size={16} className="text-white/70" />
                    Back to start
                  </GhostButton>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/70">
                  <Loader2 className="animate-spin" size={18} />
                  Creating your room…
                </div>

                {error ? (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-200/90">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-3">
                  <GhostButton
                    onClick={() => {
                      setCreating(false);
                      didCreateRef.current = false;
                      setError(null);
                    }}
                  >
                    Cancel
                  </GhostButton>
                </div>
              </>
            )}
          </div>
        </GlowCard>
      </div>
    </EntryShell>
  );
}
