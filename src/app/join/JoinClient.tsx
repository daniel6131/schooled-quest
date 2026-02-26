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
import { cleanRoomCode, setLocalStorageString, useLocalStorageString } from '@/lib/persist';
import { ArrowLeft, ArrowRight, KeyRound, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

const LS_NAME = 'sq_name_last';

export default function JoinClient() {
  const router = useRouter();
  const params = useSearchParams();

  const savedName = useLocalStorageString(LS_NAME, '');
  const queryName = (params.get('name') || '').trim();

  const [nameDraft, setNameDraft] = useState(queryName || savedName);
  const [codeRaw, setCodeRaw] = useState('');

  const name = useMemo(() => nameDraft.trim(), [nameDraft]);
  const code = useMemo(() => cleanRoomCode(codeRaw), [codeRaw]);

  const nameOk = name.length >= 2 && name.length <= 18;
  const codeOk = code.length >= 4;

  function join() {
    if (!nameOk || !codeOk) return;
    setLocalStorageString(LS_NAME, name.slice(0, 18));
    router.push(`/play/${code}?name=${encodeURIComponent(name)}`);
  }

  return (
    <EntryShell>
      <div className="w-full">
        <GlowCard>
          <div className="flex flex-col gap-6">
            <div className="text-center">
              <GradientTitle>Join a lobby</GradientTitle>
              <SubtleLead>Enter the room code and you’ll land in the lobby instantly.</SubtleLead>
            </div>

            {/* Name */}
            <div>
              <InputLabel>
                <span className="inline-flex items-center gap-2">
                  <User size={14} className="text-white/55" />
                  Your name
                </span>
              </InputLabel>
              <NeonInput
                value={nameDraft}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 18);
                  setNameDraft(v);
                  setLocalStorageString(LS_NAME, v);
                }}
                placeholder="e.g. NeonNinja"
                autoComplete="nickname"
                inputMode="text"
              />
              <HintText className="mt-2">{nameOk ? '✓ Ready' : '2–18 characters'}</HintText>
            </div>

            {/* Code */}
            <div>
              <InputLabel>
                <span className="inline-flex items-center gap-2">
                  <KeyRound size={14} className="text-white/55" />
                  Room code
                </span>
              </InputLabel>
              <NeonInput
                value={code}
                onChange={(e) => setCodeRaw(e.target.value)}
                placeholder="ABCDE"
                className="text-center tracking-[0.35em] uppercase"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '16px',
                  fontWeight: 700,
                }}
                inputMode="text"
                autoComplete="one-time-code"
                maxLength={5}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') join();
                }}
              />
              <div className="mt-2 flex items-center justify-between">
                <HintText>{codeOk ? '✓ Code looks valid' : 'At least 4 characters'}</HintText>
                <HintText>
                  <span className="tabular-nums">{code.length}/5</span>
                </HintText>
              </div>
            </div>

            {/* Actions */}
            <div className="grid gap-3">
              <CTAButton disabled={!nameOk || !codeOk} onClick={join}>
                <span className="inline-flex items-center gap-2">
                  Enter lobby
                  <ArrowRight size={18} />
                </span>
              </CTAButton>

              <GhostButton onClick={() => router.push('/')}>
                <ArrowLeft size={16} className="text-white/70" />
                Back
              </GhostButton>
            </div>
          </div>
        </GlowCard>
      </div>
    </EntryShell>
  );
}
