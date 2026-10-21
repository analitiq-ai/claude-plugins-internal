---
schemaVersion: 0.1.0
id: "0005"
title: "Path and entity"
status: accepted
date: 2026-10-01
deciders: ["@fixture"]
scope: component
reversibility: two-way-door
blastRadius: component
affects:
  - type: path
    pattern: "lib/**"
  - type: entity
    pattern: "billing"
---

# ADR-0005: Path and entity

## Context

A fixture record for the decision check's tests.

## Decision

Path and entity.

## Consequences

None outside the tests.
