---
schemaVersion: 0.1.0
id: "0006"
title: "Same id"
status: accepted
date: 2026-10-01
deciders: ["@fixture"]
scope: component
reversibility: two-way-door
blastRadius: component
affects:
  - type: path
    pattern: "dup/**"
---

# ADR-0006: Same id

## Context

A fixture record for the decision check's tests.

## Decision

Same id.

## Consequences

None outside the tests.
