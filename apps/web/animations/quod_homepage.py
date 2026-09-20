"""Looping geometric hero animations for the Quod homepage.

The scenes intentionally use only Cairo/vector Manim primitives: no fonts, TeX,
external images, or runtime data are required.  Each scene returns to its first
frame after DURATION seconds, allowing an HTML video element to loop cleanly.
"""

from __future__ import annotations

import math
import random

from manim import (
    BLUE_E,
    BLUE_C,
    Circle,
    Create,
    Dot,
    FadeIn,
    Line,
    ManimColor,
    Scene,
    VGroup,
    ValueTracker,
    always_redraw,
    config,
    interpolate_color,
)


DURATION = 10
BACKGROUND = "#04070b"
COPPER = "#db935f"
CREAM = "#f4f1de"
ICE = "#a3c0dd"
INK_BLUE = "#496f99"


def periodic_time(tracker: ValueTracker) -> float:
    """Return a 0..1 cycle; modulo makes the terminal frame match the first."""
    return (tracker.get_value() % DURATION) / DURATION


class QuodScene(Scene):
    def setup(self):
        super().setup()
        self.camera.background_color = BACKGROUND

    def cycle(self, tracker: ValueTracker):
        self.play(tracker.animate.set_value(DURATION), run_time=DURATION, rate_func=lambda t: t)


class Sphere(QuodScene):
    """Copper and cream particle cloud, rotating around a soft sphere volume."""

    def construct(self):
        random.seed(13)
        clock = ValueTracker(0)
        points = []
        count = 620
        golden = math.pi * (3 - math.sqrt(5))
        for index in range(count):
            y = 1 - 2 * (index + 0.5) / count
            radial = math.sqrt(max(0, 1 - y * y)) * random.uniform(0.77, 1.05)
            points.append((y + random.uniform(-0.025, 0.025), radial, index * golden, random.random()))

        cloud = VGroup()
        for y, radial, angle, grain in points:
            color = COPPER if y > 0.10 else CREAM
            cloud.add(Dot(radius=0.012 + grain * 0.013, color=color, fill_opacity=0.25 + grain * 0.70))

        def update_cloud(group):
            cycle = periodic_time(clock)
            rotation = math.tau * cycle
            for dot, (y, radial, angle, grain) in zip(group, points):
                theta = angle + rotation
                x = math.cos(theta) * radial
                z = math.sin(theta) * radial
                perspective = 0.84 + (z + 1) * 0.20
                dot.move_to([x * 3.05 * perspective - 1.25, y * 3.05 * perspective, 0])
                dot.set_fill(opacity=(0.18 + grain * 0.72) * (0.42 + (z + 1) * 0.30))

        cloud.add_updater(update_cloud)
        update_cloud(cloud)
        halo = Circle(radius=2.35, color=COPPER, stroke_opacity=0.08, stroke_width=1).shift([-1.25, 0, 0])
        self.add(halo, cloud)
        self.cycle(clock)


class Surface(QuodScene):
    """Rotating blue/copper sine surface, projected into a compact wireframe."""

    def construct(self):
        clock = ValueTracker(0)
        resolution = 25

        def point(u: float, v: float):
            phase = math.tau * periodic_time(clock)
            z = 0.58 * math.sin(2.1 * u + phase) * math.cos(2.4 * v) + 0.22 * math.sin(3 * v - phase)
            turn = phase * 0.34
            x = u * math.cos(turn) - v * math.sin(turn)
            y = u * math.sin(turn) + v * math.cos(turn)
            return [x * 3.25 - 0.75, y * 1.30 - z * 1.55, 0]

        def strand(constant: float, vertical: bool):
            samples = []
            for n in range(resolution + 1):
                other = -1 + 2 * n / resolution
                samples.append(point(constant, other) if vertical else point(other, constant))
            height = 0.5 + 0.5 * math.sin(constant * 3 + math.tau * periodic_time(clock))
            color = interpolate_color(BLUE_C, ManimColor(COPPER), height)
            return Line(samples[0], samples[1], color=color, stroke_width=1.05, stroke_opacity=0.35).set_points_as_corners(samples)

        mesh = VGroup()
        for n in range(24):
            c = -1 + 2 * n / 23
            mesh.add(always_redraw(lambda c=c: strand(c, True)))
            mesh.add(always_redraw(lambda c=c: strand(c, False)))
        self.add(mesh)
        self.cycle(clock)


class Lattice(QuodScene):
    """Five-layer blue/copper proof DAG with continuous travelling pulses."""

    def construct(self):
        random.seed(7919)
        clock = ValueTracker(0)
        counts = [5, 8, 10, 8, 5]
        nodes = []
        for layer, count in enumerate(counts):
            for index in range(count):
                nodes.append((layer, (index + 0.5) / count + random.uniform(-0.035, 0.035), random.random(), random.random() * math.tau))

        edges = []
        for index, node in enumerate(nodes):
            layer = node[0]
            if layer == len(counts) - 1:
                continue
            next_indices = [i for i, other in enumerate(nodes) if other[0] == layer + 1]
            for _ in range(1 + int(random.random() > 0.42)):
                edges.append((index, random.choice(next_indices), random.random()))

        def position(node):
            layer, vertical, _, phase = node
            t = periodic_time(clock)
            return [-5.65 + layer * 2.45, 2.75 - vertical * 5.5 + math.sin(math.tau * t + phase) * 0.075, 0]

        edge_group = VGroup()
        for start, end, offset in edges:
            edge_group.add(always_redraw(lambda start=start, end=end: Line(position(nodes[start]), position(nodes[end]), color=INK_BLUE, stroke_width=0.75, stroke_opacity=0.36)))

        pulse_group = VGroup()
        for edge_index, (start, end, offset) in enumerate(edges):
            def pulse(start=start, end=end, offset=offset, edge_index=edge_index):
                t = (periodic_time(clock) + offset + edge_index * 0.031) % 1
                start_point, end_point = position(nodes[start]), position(nodes[end])
                point = [start_point[i] + (end_point[i] - start_point[i]) * t for i in range(3)]
                return Dot(point, radius=0.032, color=COPPER, fill_opacity=math.sin(math.pi * t) * 0.95)
            pulse_group.add(always_redraw(pulse))

        node_group = VGroup()
        for node in nodes:
            def node_dot(node=node):
                t = periodic_time(clock)
                layer, _, weight, phase = node
                color = COPPER if weight > 0.55 else ICE
                radius = 0.045 + weight * 0.060
                glow = Dot(position(node), radius=radius * (2.3 + 0.45 * math.sin(math.tau * t + phase)), color=color, fill_opacity=0.10)
                core = Dot(position(node), radius=radius, color=color, fill_opacity=0.9)
                return VGroup(glow, core)
            node_group.add(always_redraw(node_dot))

        self.add(edge_group, pulse_group, node_group)
        self.cycle(clock)
