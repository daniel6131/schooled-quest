'use client';

import { EntryShell } from '@/components/entry/EntryShell';
import {
  CTAButton,
  FeaturePill,
  GhostButton,
  GlowCard,
  GradientTitle,
  HintText,
  InputLabel,
  LogoMark,
  NeonInput,
  SubtleLead,
} from '@/components/entry/primitives';
import { setLocalStorageString, useLocalStorageString } from '@/lib/persist';
import { ArrowRight, Crown, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

const LS_NAME = 'sq_name_last';

export default function EntryClient() {
  const router = useRouter();
  const name = useLocalStorageString(LS_NAME, '');

  const trimmedName = name.trim();
  const nameOk = trimmedName.length >= 2 && trimmedName.length <= 18;

  const subtitle = useMemo(() => {
    if (!trimmedName) return 'Pick a name — then host a lobby or join with a code.';
    if (!nameOk) return 'Name must be 2–18 characters.';
    return 'Ready. Choose your path.';
  }, [trimmedName, nameOk]);

  return (
    <EntryShell
      footer={
        <HintText>
          On desktop you can use <span className="text-white/55">Tab</span> +{' '}
          <span className="text-white/55">Enter</span>.
        </HintText>
      }
    >
      <div className="w-full">
        {/* Pills */}
        <div className="mb-7 flex flex-wrap items-center justify-center gap-2">
          <FeaturePill color="cyan">LAN-friendly</FeaturePill>
          <FeaturePill color="violet">Party-ready</FeaturePill>
          <FeaturePill color="pink">Power-ups</FeaturePill>
          <FeaturePill color="gold">Boss fights</FeaturePill>
        </div>

        <GlowCard>
          <div className="flex flex-col gap-7">
            {/* Header */}
            <div className="flex flex-col items-center text-center">
              <LogoMark size={56} />
              <div className="mt-4">
                <GradientTitle>Schooled Quest</GradientTitle>
                <SubtleLead>{subtitle}</SubtleLead>
              </div>
            </div>

            {/* Name */}
            <div>
              <InputLabel>Display Name</InputLabel>
              <NeonInput
                value={name}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 18);
                  setLocalStorageString(LS_NAME, v);
                }}
                placeholder="e.g. PixelWizard"
                autoComplete="nickname"
                inputMode="text"
              />
              <HintText className="mt-2">
                {nameOk ? (
                  <span style={{ color: 'rgba(167,139,250,0.75)' }}>✓ Looks good</span>
                ) : (
                  '2–18 characters'
                )}
              </HintText>
            </div>

            {/* Actions */}
            <div className="grid gap-3">
              <CTAButton
                disabled={!nameOk}
                onClick={() => {
                  if (!nameOk) return;
                  router.push(`/host?name=${encodeURIComponent(trimmedName)}`);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Crown size={18} />
                  Host a lobby
                </span>
                <ArrowRight size={18} />
              </CTAButton>

              <GhostButton
                disabled={!nameOk}
                onClick={() => {
                  if (!nameOk) return;
                  router.push(`/join?name=${encodeURIComponent(trimmedName)}`);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Users size={18} className="text-white/70" />
                  Join with a code
                </span>
                <ArrowRight size={18} className="text-white/65" />
              </GhostButton>
            </div>

            {/* Tiny helper */}
            <div className="text-center">
              <HintText>Hosting creates a room code you can share instantly.</HintText>
            </div>
          </div>
        </GlowCard>
      </div>
    </EntryShell>
  );
}
